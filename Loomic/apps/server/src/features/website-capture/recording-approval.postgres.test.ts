import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import Fastify, { type FastifyRequest } from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimApprovedRecording, decideRecordingApproval, recordingActionFromTask, requestRecordingApproval } from "./recording-approval.js";
import { completeWebsiteCapture } from "./complete-capture.js";
import { captureIsolatedWebsite } from "./isolated-browser.js";
import { LocalStorageProvider } from "../../storage/local-storage.js";
import { registerLocalAssetRoutes } from "../../http/local-assets.js";
import { saveWebsiteLogin, attachWebsiteLogin, consumeWebsiteLogin, purgeWebsiteLogins, discardWebsiteLogin } from "./login-vault.js";
import { queueHandoffInput,takeHandoffInput,finishHandoffInput,handoffReceipt,endHandoff } from "./handoff-store.js";
import { browserViewStore } from "../agent-browser/store.js";
import { rememberWebsiteSession,restoreWebsiteSession } from "./saved-login.js";
import { launchAgentBrowser } from "../agent-browser/engine.js";

const databaseUrl = process.env.HELT_TEST_DATABASE_URL ?? process.env.HELT_AUTH_DB_URL ?? "";
const enabled = Boolean(databaseUrl)&&(process.env.HELT_AUTH_DB_TEST === "1"||Boolean(process.env.HELT_TEST_DATABASE_URL));
const schema = `recording_test_${randomUUID().replaceAll("-", "")}`;
const workspaceId = randomUUID();
const userId = randomUUID();
let admin: Pool;
let db: Pool;

describe.skipIf(!enabled)("recording approvals with PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) throw new Error("Recording approval tests require localhost.");
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`create schema ${schema}`);
    db = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await db.query(`
      create table workspaces (id uuid primary key);
      create table app_users (id uuid primary key);
      create table workspace_members (workspace_id uuid not null, user_id uuid not null);
      create table chat_sessions (id uuid primary key, created_by uuid not null);
      create table chat_messages (id uuid primary key default gen_random_uuid(), session_id uuid not null,
        role text not null, content text not null, client_message_id text not null, unique(session_id, client_message_id));
      create table asset_objects (id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
        bucket text not null, object_path text not null, mime_type text not null, byte_size integer not null, created_by uuid not null);
      create table generated_assets (id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
        created_by uuid not null, media_type text not null, object_path text not null, mime_type text not null,
        title text not null, description text not null, prompt text not null, metadata jsonb, website_capture_task_id uuid);
      create table website_capture_tasks (id uuid primary key, workspace_id uuid not null, created_by uuid not null,
        start_url text not null, mode text not null, page_limit integer not null, follow_external boolean not null,
        session_id uuid, assistant_connection_id uuid, record_video boolean not null, status text not null,
        stage text not null, background_job_id uuid, progress integer not null default 0, updated_at timestamptz default now(),
        result jsonb, error_message text, completed_at timestamptz);
    `);
    await db.query("insert into workspaces values ($1)", [workspaceId]);
    await db.query("insert into app_users values ($1)", [userId]);
    await db.query("insert into workspace_members values ($1,$2)", [workspaceId, userId]);
    const migration = await readFile(new URL("../../local-db/migrations/20261103000000_website_recording_approvals.sql", import.meta.url), "utf8");
    await db.query(migration);
    await db.query(migration);
    await db.query(await readFile(new URL("../../local-db/migrations/20261108000000_website_presentations.sql",import.meta.url),"utf8"));
    await db.query(await readFile(new URL("../../local-db/migrations/20261108000001_website_login.sql",import.meta.url),"utf8"));
    await db.query(await readFile(new URL("../../local-db/migrations/20261107000001_agent_browser_views.sql",import.meta.url),"utf8"));
    await db.query(await readFile(new URL("../../local-db/migrations/20261108000002_website_journeys.sql",import.meta.url),"utf8"));
  });

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`drop schema if exists ${schema} cascade`);
      await admin.end();
    }
  });

  async function createTask() {
    const id = randomUUID();
    const { rows } = await db.query(`insert into website_capture_tasks
      (id, workspace_id, created_by, start_url, mode, page_limit, follow_external, record_video, status, stage)
      values ($1,$2,$3,'https://example.com/','isolated_browser',1,false,true,'queued','queued') returning *`, [id, workspaceId, userId]);
    return rows[0];
  }

  it("consumes an approved action at most once under concurrent claims", async () => {
    const task = await createTask();
    const approval = await requestRecordingApproval(db, task.id, workspaceId, userId);
    expect(await decideRecordingApproval(db, approval.id, workspaceId, userId, true)).toBe(true);
    const action = recordingActionFromTask(task);
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimApprovedRecording(db, task.id, action, approval.id)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    const { rows } = await db.query("select a.status as approval_status, t.status as task_status from website_recording_approvals a join website_capture_tasks t on t.id=a.task_id where a.id=$1", [approval.id]);
    expect(rows[0]).toEqual({ approval_status: "consumed", task_status: "running" });
  });
  it('binds the route order to approval',async()=>{
    const task=await createTask(),journey={goal:'先首页再定价',summary:'两页',steps:[{title:'首页',url:'https://example.com/',scroll:true},{title:'定价',linkText:'定价',scroll:true}]};
    await db.query('update website_capture_tasks set journey=$2 where id=$1',[task.id,journey]);
    const approval=await requestRecordingApproval(db,task.id,workspaceId,userId);
    await db.query('update website_capture_tasks set journey=$2 where id=$1',[task.id,{...journey,steps:[...journey.steps].reverse()}]);
    expect(await decideRecordingApproval(db,approval.id,workspaceId,userId,true)).toBe(false);
  });
  it('encrypts manual input, rejects stale frames and consumes a duplicate command once',async()=>{
    const prior=process.env.WEBSITE_LOGIN_ENCRYPTION_KEY;process.env.WEBSITE_LOGIN_ENCRYPTION_KEY=Buffer.alloc(32,9).toString('base64');
    const root=await mkdtemp(join(tmpdir(),'handoff-db-'));
    try{
      const task=await createTask();await db.query("update website_capture_tasks set status='running',stage='waiting_login' where id=$1",[task.id]);
      const store=browserViewStore(db,root),viewId=await store.create({taskId:task.id,workspaceId,userId,engine:'chromium',name:'登录验证'});
      await store.enableHandoff(viewId);await store.writeFrame(viewId,Buffer.from('test-frame'),{url:'https://example.com/login',title:'Login',width:1280,height:720});
      const input={id:randomUUID(),viewId,frameRevision:1,pageUrl:'https://example.com/login',input:{kind:'text' as const,text:'private-otp'}};
      await queueHandoffInput(db,{workspaceId,userId},input);await queueHandoffInput(db,{workspaceId,userId},input);
      expect(JSON.stringify((await db.query('select * from website_handoff_commands where id=$1',[input.id])).rows)).not.toContain('private-otp');
      await expect(queueHandoffInput(db,{workspaceId,userId:randomUUID()},{...input,id:randomUUID()})).rejects.toThrow();
      await expect(queueHandoffInput(db,{workspaceId,userId},{...input,id:randomUUID(),pageUrl:'https://example.com/changed'})).rejects.toThrow();
      const claims=await Promise.all([takeHandoffInput(db,viewId),takeHandoffInput(db,viewId)]);
      expect(claims.filter(Boolean)).toHaveLength(1);expect(claims.find(Boolean)?.input).toEqual(input.input);
      expect((await db.query('select ciphertext from website_handoff_commands where id=$1',[input.id])).rows[0].ciphertext).toBeNull();
      await finishHandoffInput(db,input.id,true);expect((await handoffReceipt(db,input.id,userId)).status).toBe('succeeded');
      await endHandoff(db,viewId);await store.eraseLoginView(viewId);
    }finally{await rm(root,{recursive:true,force:true});if(prior===undefined)delete process.env.WEBSITE_LOGIN_ENCRYPTION_KEY;else process.env.WEBSITE_LOGIN_ENCRYPTION_KEY=prior;}
  });
  it('restores an encrypted remembered session only for its owner and origin',async()=>{
    const prior=process.env.WEBSITE_LOGIN_ENCRYPTION_KEY;process.env.WEBSITE_LOGIN_ENCRYPTION_KEY=Buffer.alloc(32,8).toString('base64');
    const {browser}=await launchAgentBrowser();
    try{
      const context=await browser.newContext();await context.addCookies([{name:'session',value:'private-cookie',url:'https://8.8.8.8/'}]);
      const page=await context.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<h1>Account</h1>'}));await page.goto('https://8.8.8.8/');await page.evaluate("sessionStorage.setItem('login','private-session')");
      await rememberWebsiteSession(db,{workspaceId,userId},'https://8.8.8.8',context,page);
      const row=(await db.query('select * from website_browser_sessions where user_id=$1',[userId])).rows[0];
      expect(JSON.stringify(row)).not.toContain('private-cookie');expect(JSON.stringify(row)).not.toContain('private-session');
      const restored=await browser.newContext();await restoreWebsiteSession(db,{workspaceId,userId},'https://8.8.8.8',row.id,restored);
      expect((await restored.cookies())[0]?.value).toBe('private-cookie');
      await expect(restoreWebsiteSession(db,{workspaceId,userId:randomUUID()},'https://8.8.8.8',row.id,restored)).rejects.toThrow();
      await expect(restoreWebsiteSession(db,{workspaceId,userId},'https://example.com',row.id,restored)).rejects.toThrow();
      await db.query('update website_browser_sessions set ciphertext=null where id=$1',[row.id]);
      await expect(restoreWebsiteSession(db,{workspaceId,userId},'https://8.8.8.8',row.id,restored)).rejects.toThrow();
    }finally{await browser.close();if(prior===undefined)delete process.env.WEBSITE_LOGIN_ENCRYPTION_KEY;else process.env.WEBSITE_LOGIN_ENCRYPTION_KEY=prior;}
  });
  it("encrypts, scopes and consumes login credentials once, with no secret in approval metadata",async()=>{
    const prior=process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
    process.env.PROVIDER_CONFIG_ENCRYPTION_KEY=Buffer.alloc(32,7).toString("base64");
    try{
      const task=await createTask();
      const credentials={loginUrl:"https://example.com/login",successText:"工作台",username:"private-user",password:"private-password"};
      const login=await saveWebsiteLogin(db,workspaceId,userId,credentials);
      await db.query("update website_capture_tasks set login=$2 where id=$1",[task.id,login]);
      await attachWebsiteLogin(db,workspaceId,userId,task.id,login);
      await expect(attachWebsiteLogin(db,workspaceId,randomUUID(),task.id,login)).rejects.toThrow();
      const stored=JSON.stringify((await db.query("select * from website_login_secrets where id=$1",[login.credentialId])).rows);
      expect(stored).not.toContain(credentials.username);expect(stored).not.toContain(credentials.password);
      const approval=await requestRecordingApproval(db,task.id,workspaceId,userId);
      expect(JSON.stringify(approval)).not.toContain(credentials.password);
      await db.query("update website_capture_tasks set login=jsonb_set(login,'{successText}','\"changed\"') where id=$1",[task.id]);
      expect(await decideRecordingApproval(db,approval.id,workspaceId,userId,true)).toBe(false);
      await db.query("update website_capture_tasks set login=$2 where id=$1",[task.id,login]);
      expect(await decideRecordingApproval(db,approval.id,workspaceId,userId,true)).toBe(true);
      const attempts=await Promise.allSettled(Array.from({length:5},()=>consumeWebsiteLogin(db,task.id,workspaceId,userId,login)));
      expect(attempts.filter(attempt=>attempt.status==="fulfilled")).toHaveLength(1);
      expect((await db.query("select ciphertext from website_login_secrets where id=$1",[login.credentialId])).rows[0].ciphertext).toBeNull();
      const expired=await saveWebsiteLogin(db,workspaceId,userId,credentials);
      await db.query("update website_login_secrets set expires_at=now()-interval '1 second' where id=$1",[expired.credentialId]);
      await purgeWebsiteLogins(db);
      expect((await db.query("select ciphertext from website_login_secrets where id=$1",[expired.credentialId])).rows[0].ciphertext).toBeNull();
      await discardWebsiteLogin(db,task.id);
    }finally{if(prior===undefined)delete process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;else process.env.PROVIDER_CONFIG_ENCRYPTION_KEY=prior;}
  });
  it("binds duration, style and cursor count to the recording approval",async()=>{
    const task=await createTask();const presentation={style:"cursor-rebuild",durationSeconds:24,cursorCount:4};
    await db.query("update website_capture_tasks set presentation=$2 where id=$1",[task.id,presentation]);
    const approval=await requestRecordingApproval(db,task.id,workspaceId,userId);expect(approval.action.presentation).toEqual(presentation);
    await db.query("update website_capture_tasks set presentation=$2 where id=$1",[task.id,{...presentation,cursorCount:6}]);
    expect(await decideRecordingApproval(db,approval.id,workspaceId,userId,true)).toBe(false);
    await db.query("update website_capture_tasks set presentation=$2 where id=$1",[task.id,presentation]);
    expect(await decideRecordingApproval(db,approval.id,workspaceId,userId,true)).toBe(true);
    expect(await claimApprovedRecording(db,task.id,{...recordingActionFromTask(task),presentation:{...presentation,durationSeconds:12}},approval.id)).toBe(false);
    expect(await claimApprovedRecording(db,task.id,{...recordingActionFromTask(task),presentation},approval.id)).toBe(true);
  });

  it("rejects changed task parameters and changed execution actions", async () => {
    const task = await createTask();
    const approval = await requestRecordingApproval(db, task.id, workspaceId, userId);
    await db.query("update website_capture_tasks set start_url='https://other.example/' where id=$1", [task.id]);
    expect(await decideRecordingApproval(db, approval.id, workspaceId, userId, true)).toBe(false);
    await db.query("update website_capture_tasks set start_url=$2 where id=$1", [task.id, task.start_url]);
    expect(await decideRecordingApproval(db, approval.id, workspaceId, userId, true)).toBe(true);
    expect(await claimApprovedRecording(db, task.id, { ...recordingActionFromTask(task), pageLimit: 2 }, approval.id)).toBe(false);
    expect(await claimApprovedRecording(db, task.id, recordingActionFromTask(task), approval.id)).toBe(true);
  });

  it("cannot claim rejected or expired approvals", async () => {
    const rejectedTask = await createTask();
    const rejected = await requestRecordingApproval(db, rejectedTask.id, workspaceId, userId);
    expect(await decideRecordingApproval(db, rejected.id, workspaceId, userId, false)).toBe(true);
    expect(await claimApprovedRecording(db, rejectedTask.id, recordingActionFromTask(rejectedTask), rejected.id)).toBe(false);
    const expiredTask = await createTask();
    const expired = await requestRecordingApproval(db, expiredTask.id, workspaceId, userId);
    expect(await decideRecordingApproval(db, expired.id, workspaceId, userId, true)).toBe(true);
    await db.query("update website_recording_approvals set expires_at=now()-interval '1 second' where id=$1", [expired.id]);
    expect(await claimApprovedRecording(db, expiredTask.id, recordingActionFromTask(expiredTask), expired.id)).toBe(false);
  });

  it("writes a completed recording to its chat only once under concurrent callbacks", async () => {
    const task = await createTask();
    const sessionId = randomUUID();
    await db.query("insert into chat_sessions values ($1,$2)", [sessionId, userId]);
    await db.query("update website_capture_tasks set session_id=$2 where id=$1", [task.id, sessionId]);
    task.session_id = sessionId;
    const approval = await requestRecordingApproval(db, task.id, workspaceId, userId);
    expect(await decideRecordingApproval(db, approval.id, workspaceId, userId, true)).toBe(true);
    expect(await claimApprovedRecording(db, task.id, recordingActionFromTask(task), approval.id)).toBe(true);
    const result = { title: "Example", introduction: "Recorded site", startUrl: task.start_url, pages: [], evidence: [], claims: [], recordingUrl: "/api/assets/recording.webm", completedAt: new Date().toISOString() };
    const completed = await Promise.all(Array.from({ length: 6 }, () => completeWebsiteCapture(db, task.id, result)));
    expect(completed.filter(Boolean)).toHaveLength(1);
    const { rows } = await db.query("select content from chat_messages where session_id=$1", [sessionId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain(result.recordingUrl);
    expect(rows[0].content).toContain(result.introduction);
  });

  it.skipIf(process.env.HELT_LIVE_CAPTURE_TEST !== "1")("records an approved public page to local assets and writes the result to chat", async () => {
    const task = await createTask();
    const sessionId = randomUUID();
    await db.query("insert into chat_sessions values ($1,$2)", [sessionId, userId]);
    await db.query("update website_capture_tasks set session_id=$2 where id=$1", [task.id, sessionId]);
    task.session_id = sessionId;
    const approval = await requestRecordingApproval(db, task.id, workspaceId, userId);
    expect(await decideRecordingApproval(db, approval.id, workspaceId, userId, true)).toBe(true);
    expect(await claimApprovedRecording(db, task.id, recordingActionFromTask(task), approval.id)).toBe(true);
    const root = await mkdtemp(join(tmpdir(), "loomic-capture-e2e-"));
    try {
      const result = await captureIsolatedWebsite({ db, task, storage: new LocalStorageProvider(root), storageRoot: root,
        webOrigin: "http://localhost:3000", onProgress: async () => {} });
      expect(result.pages).toHaveLength(1);
      expect(result.recordingAssetId).toBeTruthy();
      const assets = await db.query("select object_path from asset_objects where id=$1 and mime_type='video/webm'", [result.recordingAssetId]);
      const bytes = await readFile(join(root, "project-assets", assets.rows[0].object_path));
      expect(bytes.length).toBeGreaterThan(100);
      expect(bytes.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
      const outsider = randomUUID();
      const app = Fastify();
      registerLocalAssetRoutes(app, { db, root, auth: { authenticate: async (request: FastifyRequest) => {
        if (request.headers.authorization === "Bearer member") return { id: userId };
        if (request.headers.authorization === "Bearer outsider") return { id: outsider };
        return null;
      } } as never });
      try {
        const path = `/api/uploads/${result.recordingAssetId}/file`;
        const unauthenticated = await app.inject({ method: "GET", url: path });
        expect(unauthenticated.statusCode).toBe(401);
        const forbidden = await app.inject({ method: "GET", url: path, headers: { authorization: "Bearer outsider" } });
        expect(forbidden.statusCode).toBe(404);
        const member = await app.inject({ method: "GET", url: path, headers: { authorization: "Bearer member" } });
        expect(member.statusCode).toBe(200);
        expect(member.headers["content-type"]).toContain("video/webm");
        expect(member.rawPayload).toEqual(bytes);
        const range = await app.inject({ method: "GET", url: path, headers: { authorization: "Bearer member", range: "bytes=0-3" } });
        expect(range.statusCode).toBe(206);
        expect(range.rawPayload).toEqual(bytes.subarray(0, 4));
      } finally {
        await app.close();
      }
      const executablePath = process.env.HELSTERA_PLAYWRIGHT_EXECUTABLE_PATH;
      const browser = await chromium.launch({ headless: true, executablePath:executablePath??chromium.executablePath() });
      try {
        const page = await browser.newPage();
        const playable = await page.evaluate(`(async (base64) => {
          const data = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([data], { type: "video/webm" }));
          const video = document.createElement("video");
          video.muted = true;
          video.src = url;
          document.body.append(video);
          try {
            await video.play();
            await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error("Recording playback did not advance")), 5000);
              video.addEventListener("timeupdate", () => {
                if (video.currentTime > 0) { clearTimeout(timer); resolve(); }
              });
              video.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Recording decoding failed")); });
            });
            return video.videoWidth > 0 && video.videoHeight > 0;
          } finally {
            video.pause();
            URL.revokeObjectURL(url);
          }
        })(${JSON.stringify(bytes.toString("base64"))})`);
        expect(playable).toBe(true);
      } finally {
        await browser.close();
      }
      expect(await completeWebsiteCapture(db, task.id, result)).toBe(true);
      const messages = await db.query("select content from chat_messages where session_id=$1", [sessionId]);
      expect(messages.rows).toHaveLength(1);
      expect(messages.rows[0].content).toContain(result.recordingUrl);
      expect(messages.rows[0].content).toContain(result.pages[0]!.screenshotUrl);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);
});
