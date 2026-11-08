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

export async function createPresentationFixture(
  databaseUrl: string,
  origin: string,
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
      "20261103000000_website_recording_approvals",
      "20261107000001_agent_browser_views",
      "20261108000000_website_presentations",
      "20261108000001_website_login",
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
        .header("Access-Control-Allow-Headers", "authorization,content-type")
        .header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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
            if(route.request().method()==="POST")return route.fulfill({status:200,contentType:"text/html; charset=utf-8",headers:{"set-cookie":"session=authorized; Path=/; Secure; HttpOnly"},body:"<h1>我的工作台</h1>"});
            return route.fulfill({contentType:"text/html; charset=utf-8",body:route.request().url().endsWith('/dashboard')?'<h1>我的工作台</h1>':'<form action="/login" method="post"><input name="username"><input name="password" type="password"><button>登录</button></form>'});
          });
          const loginPage=await sourceContext.newPage();
          await signInWebsite(loginPage,credentials,scope,async()=>{});
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
          config: task.presentation,
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
              assertActive,
            });
          },
          checkpoint: async () => {
            await assertActive();
            return await observer?.beforeAction("正在录制网站演示", null);
          },
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
        const result = {
          title: "演示验收",
          introduction: "网站介绍演示已完成。",
          startUrl: task.start_url,
          pages: [],
          claims: [],
          evidence: [],
          recordingAssetId: asset.id,
          recordingUrl: asset.url,
          completedAt: new Date().toISOString(),
          presentation: task.presentation,
        };
        await completeWebsiteCapture(db, task.id, result);
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
      jobService: jobs,
      assistantHub: {} as never,
    });
    registerAgentBrowserRoutes(app, {
      auth,
      viewerService,
      db,
      storageRoot: root,
      enabled: true,
    });
    registerLocalAssetRoutes(app, { auth, db, root });
    await app.listen({ port: 3315, host: "127.0.0.1" });
    return { app, db, root, sessionId, userId, workspaceId, token, close };
  } catch (error) {
    await close();
    throw error;
  }
}
