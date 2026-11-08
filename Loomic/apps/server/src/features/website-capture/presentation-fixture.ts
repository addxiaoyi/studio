import { randomUUID, randomBytes } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyRequest } from "fastify";
import { Pool } from "pg";
import { registerWebsiteCaptureRoutes } from "../../http/website-capture.js";
import { registerAgentBrowserRoutes } from "../../http/agent-browser.js";
import { registerLocalAssetRoutes } from "../../http/local-assets.js";
import { createLocalJobService } from "../../local-db/job-service.js";
import { LocalStorageProvider } from "../../storage/local-storage.js";
import { launchAgentBrowser } from "../agent-browser/engine.js";
import { browserViewStore } from "../agent-browser/store.js";
import { observeAgentBrowser } from "../agent-browser/observer.js";
import { capturePresentationScene } from "./presentation-snapshot.js";
import { recordWebsitePresentation } from "./presentation.js";
import {
  claimApprovedRecording,
  recordingActionFromTask,
} from "./recording-approval.js";
import { completeWebsiteCapture } from "./complete-capture.js";
import { persistCaptureAsset } from "./isolated-browser.js";
import { consumeWebsiteLogin } from "./login-vault.js";
import { allowLoginRequest, signInWebsite, newAuthenticatedContext } from "./login-session.js";
import { waitForWebsiteLogin } from "./login-handoff.js";
import { rememberWebsiteSession } from "./saved-login.js";
import { registerWebsiteJourneyRoutes } from "../../http/website-journey.js";
import { finishCaptureCanvasDelivery } from "./canvas-delivery.js";
import { registerCanvasRoutes } from "../../http/canvases.js";
import { registerChatRoutes } from "../../http/chat.js";
import { registerProjectRoutes } from "../../http/projects.js";
import { createLocalCanvasService } from "../../local-db/canvas-service.js";
import { createLocalChatService } from "../../local-db/chat-service.js";
import { createLocalProjectService } from "../../local-db/project-service.js";

export async function createPresentationFixture(
  databaseUrl: string,
  origin: string,
  configure?: (context: { app: ReturnType<typeof Fastify>; db: Pool; auth: import("../../auth/types.js").RequestAuthenticator; viewerService: import("../bootstrap/ensure-user-foundation.js").ViewerService; browser: import("playwright").Browser; storage: LocalStorageProvider; root: string; userId: string; workspaceId: string; canvasId: string; sessionId: string }) => Promise<void>,
) {
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)
  )
    throw new Error("Presentation fixture requires local PostgreSQL.");
  const schema = `presentation_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`create schema ${schema}`);
  const db = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
  });
  const root = await mkdtemp(join(tmpdir(), "loomic-presentation-flow-"));
  const userId = randomUUID(),
    workspaceId = randomUUID(),
    projectId = randomUUID(),
    canvasId = randomUUID(),
    sessionId = randomUUID(),
    token = randomUUID();
  const app = Fastify(),
    work: Promise<void>[] = [];
  const priorKey=process.env.WEBSITE_LOGIN_ENCRYPTION_KEY;
  process.env.WEBSITE_LOGIN_ENCRYPTION_KEY=randomBytes(32).toString("base64");
  const { browser, engine } = await launchAgentBrowser();
  const storage = new LocalStorageProvider(root, "http://localhost:3315");
  async function close() {
    await db.query("update website_capture_tasks set status='canceled' where status in ('queued','running')");
    await Promise.allSettled(work);
    await browser.close();
    await app.close();
    await db.end();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
    if(priorKey===undefined)delete process.env.WEBSITE_LOGIN_ENCRYPTION_KEY;else process.env.WEBSITE_LOGIN_ENCRYPTION_KEY=priorKey;
  }
  try {
    await db.query(
      await readFile(
        new URL("../../local-db/schema.sql", import.meta.url),
        "utf8",
      ),
    );
    for (const file of [
      "20261020000000_website_capture",
      "20261020000001_website_capture_job_link",
      "20261020000002_website_capture_assistant",
      "20261020000003_website_capture_promo",
      "20261022000001_website_capture_asset_links",
      "20261022000002_scope_website_capture_idempotency",
      "20261024000000_cloud_asset_retention_3_days",
      "20261029000000_canvas_content_version",
      "20261103000000_website_recording_approvals",
      "20261107000001_agent_browser_views",
      "20261108000000_website_presentations",
      "20261108000001_website_login",
      "20261108000002_website_journeys",
      "20261108000003_website_session_revocation",
    ]) {
      await db.query(
        await readFile(
          new URL(`../../local-db/migrations/${file}.sql`, import.meta.url),
          "utf8",
        ),
      );
    }
    await db.query(
      "create table agent_connector_permissions(workspace_id uuid,user_id uuid,connector_id text,enabled boolean)",
    );
    await db.query(
      "insert into app_users(id,email) values($1,'presentation@example.test')",
      [userId],
    );
    await db.query(
      "insert into workspaces(id,owner_user_id,name) values($1,$2,'Presentation')",
      [workspaceId, userId],
    );
    await db.query(
      "insert into workspace_members(workspace_id,user_id) values($1,$2)",
      [workspaceId, userId],
    );
    await db.query(
      "insert into projects(id,workspace_id,created_by,name,slug) values($1,$2,$3,'Website demo','website-demo')",
      [projectId, workspaceId, userId],
    );
    await db.query(
      "insert into canvases(id,project_id,created_by,name) values($1,$2,$3,'Demo')",
      [canvasId, projectId, userId],
    );
    await db.query(
      "insert into chat_sessions(id,canvas_id,created_by,thread_id,title) values($1,$2,$3,$4,'Presentation acceptance')",
      [sessionId, canvasId, userId, sessionId],
    );
    const auth = {
      authenticate: async (request: FastifyRequest) =>
        request.headers.authorization === `Bearer ${token}`
          ? {
              id: userId,
              accessToken: token,
              email: "presentation@example.test",
              userMetadata: {},
            }
          : null,
    };
    const viewerService = {
      ensureViewer: async () => ({ workspace: { id: workspaceId } }),
    } as never;
    app.addHook("onRequest", async (request, reply) => {
      if (request.headers.origin && request.headers.origin !== origin)
        return reply.code(403).send({ error: "Unexpected origin" });
      reply
        .header("Access-Control-Allow-Origin", origin)
        .header("Access-Control-Allow-Credentials", "true")
        .header("Access-Control-Allow-Headers", "authorization,content-type,if-match")
        .header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
      if (request.method === "OPTIONS") return reply.code(204).send();
    });
    app.get("/api/local-auth/session", async () => ({
      session: {
        access_token: token,
        user: { id: userId, email: "presentation@example.test" },
      },
    }));
    const jobs = createLocalJobService(db),
      create = jobs.createJob;
    jobs.createJob = async (user, input) => {
      const job = await create(user, input);
      if (!job.reused) {
        work.push(
          new Promise<void>((resolve) => setTimeout(resolve, 30)).then(() =>
            run(
              job.id,
              input.payload as {
                task_id: string;
                recording_approval_id: string;
              },
            ),
          ),
        );
      }
      return job;
    };
    async function run(
      jobId: string,
      payload: { task_id: string; recording_approval_id: string },
    ) {
      const task = (
        await db.query("select * from website_capture_tasks where id=$1", [
          payload.task_id,
        ])
      ).rows[0];
      if (
        !(await claimApprovedRecording(
          db,
          task.id,
          recordingActionFromTask(task),
          payload.recording_approval_id,
        ))
      )
        return;
      let observer: Awaited<ReturnType<typeof observeAgentBrowser>> | undefined;
      try {
        await jobs.markRunning(jobId);
        let sourceContext=await browser.newContext();
        if(task.login){
          const credentials=await consumeWebsiteLogin(db,task.id,workspaceId,userId,task.login);
          const scope={origin:"https://8.8.8.8",submitting:false,username:credentials.username,password:credentials.password};
          await sourceContext.route("**/*",async route=>{
            if(!allowLoginRequest(route.request(),scope))return route.abort();
            if(route.request().method()==="POST")return route.fulfill({status:200,contentType:"text/html; charset=utf-8",headers:{"set-cookie":"session=authorized; Path=/; Secure; HttpOnly"},body:"<h1>我的工作台</h1><a href='/logout'>退出登录</a>"});
            const interactive='<h1>请输入验证码</h1><form action="/verify" method="post"><input name="otp" autocomplete="one-time-code" style="position:absolute;left:50px;top:120px;width:240px;height:40px"><button style="position:absolute;left:50px;top:200px;width:120px;height:40px">验证</button></form>';
            return route.fulfill({contentType:"text/html; charset=utf-8",body:credentials.method==='interactive'?interactive:route.request().url().endsWith('/dashboard')?'<h1>我的工作台</h1>':'<form action="/login" method="post"><input name="username"><input name="password" type="password"><button>登录</button></form>'});
          });
          const loginPage=await sourceContext.newPage();
          await signInWebsite(loginPage,credentials,scope,async()=>{},check=>waitForWebsiteLogin({page:loginPage,db,storageRoot:root,taskId:task.id,workspaceId,userId,engine,check,assertActive:async()=>{const row=(await db.query('select status from website_capture_tasks where id=$1',[task.id])).rows[0];if(row.status!=='running')throw new Error('Task canceled');},heartbeat:async()=>{await jobs.updateProgress(jobId,8,'waiting_login');}}));
          if(credentials.rememberSession)await rememberWebsiteSession(db,{workspaceId,userId},'https://8.8.8.8',sourceContext,loginPage);
          sourceContext=await newAuthenticatedContext(browser,sourceContext,undefined,[credentials.username,credentials.password]);
        }
        const page = await sourceContext.newPage();
        await page.route("https://8.8.8.8/", (route) =>
          route.fulfill({
            contentType: "text/html; charset=utf-8",
            body: '<title>演示验收</title><body style="font:24px system-ui;background:#f5f5fa;padding:50px"><h1>让网站成为一段故事</h1><p>多个光标共同绘制布局与文字</p><section style="border:1px solid #ddd;padding:40px;background:white">素材、创作、发布</section></body>',
          }),
        );
        await page.goto("https://8.8.8.8/");
        const scene = await capturePresentationScene(page);
        await page.close();
        await sourceContext.close();
        const assertActive = async () => {
          const row = (
            await db.query(
              "select status from website_capture_tasks where id=$1",
              [task.id],
            )
          ).rows[0];
          if (row.status !== "running") throw new Error("Task canceled");
        };
        const recording = await recordWebsitePresentation({
          browser,
          directory: root,
          scenes: [scene],
          config: task.presentation??{style:'cursor-rebuild',durationSeconds:12,cursorCount:4},
          onPage: async (preview) => {
            observer = await observeAgentBrowser({
              page: preview,
              store: browserViewStore(db, root),
              taskId: task.id,
              userId,
              workspaceId,
              engine,
              sourceUrl: task.start_url,
              name: "网站介绍演示",
              externalFrames:true,
              assertActive,
            });
          },
          checkpoint: async () => {
            await assertActive();
            return await observer?.beforeAction("正在录制网站演示", null);
          },
          onFrame:async bytes=>observer?.publishFrame(bytes),
          onProgress: async (progress) => {
            await db.query(
              "update website_capture_tasks set stage='presentation_recording',progress=$2 where id=$1",
              [task.id, progress],
            );
          },
        });
        const asset = await persistCaptureAsset({
          db,
          storage,
          storageRoot: root,
          webOrigin: origin,
          task,
          bytes: await readFile(recording),
          mimeType: "video/webm",
          mediaType: "video",
          title: "网站介绍演示",
          metadata: { presentation: task.presentation },
        });
        const screenshot = await persistCaptureAsset({ db, storage, storageRoot: root, webOrigin: origin, task,
          bytes: Buffer.from(scene.image.split(",")[1]!, "base64"), mimeType: "image/jpeg", mediaType: "image",
          title: "页面截图", metadata: { width: scene.width, height: scene.height } });
        const result = {
          title: "演示验收",
          introduction: "## 演示验收\n\n**网站定位**：网站介绍演示已完成。\n\n[来源页面](https://8.8.8.8/)",
          startUrl: task.start_url,
          pages: [{ url: task.start_url, title: "演示验收", description: "网站介绍", headings: ["演示验收"], navigation: [], assetId: screenshot.id, screenshotUrl: screenshot.url }],
          claims: [],
          evidence: [],
          recordingAssetId: asset.id,
          recordingUrl: asset.url,
          completedAt: new Date().toISOString(),
          presentation: task.presentation,
          recordingDurationSeconds: 12,
          canvasDelivery: { status: "pending" as const, elementIds: [] },
        };
        await completeWebsiteCapture(db, task.id, result);
        await finishCaptureCanvasDelivery(db, storage, task.id);
        await jobs.markSucceeded(jobId, result);
        await observer?.close("completed", "演示已保存");
      } catch (error) {
        await observer?.close("failed", "演示失败");
        await db.query(
          "update website_capture_tasks set status='failed',error_message=$2 where id=$1",
          [task.id, String(error)],
        );
        throw error;
      }
    }
    registerWebsiteCaptureRoutes(app, {
      auth,
      viewerService,
      db,
      storage,
      jobService: jobs,
      assistantHub: {} as never,
    });
    registerWebsiteJourneyRoutes(app,{auth,viewerService,browserDb:db,env:{} as never,settingsService:{getChatModelConfig:async()=>({model:'fixture-model'})} as never,observeSite:async()=>({title:'演示验收',links:[]}),createPlanModel:()=>({invoke:async()=>({content:JSON.stringify({summary:'查看首页内容并完成登录后录制。',steps:[{title:'查看首页',url:'https://8.8.8.8/',scroll:true}],recording:'presentation',durationSeconds:12,loginSuggested:true})})}) as never});
    registerAgentBrowserRoutes(app, {
      auth,
      viewerService,
      db,
      storageRoot: root,
      enabled: true,
    });
    registerLocalAssetRoutes(app, { auth, db, root });
    await registerCanvasRoutes(app, { auth, canvasService: createLocalCanvasService(db) });
    await registerChatRoutes(app, { auth, chatService: createLocalChatService(db) });
    await registerProjectRoutes(app, { auth, projectService: createLocalProjectService(db, root) });
    await configure?.({app,db,auth,viewerService,browser,storage,root,userId,workspaceId,canvasId,sessionId});
    await app.listen({ port: 3315, host: "127.0.0.1" });
    return { app, db, root, sessionId, canvasId, userId, workspaceId, token, close };
  } catch (error) {
    await close();
    throw error;
  }
}
