import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyRequest } from "fastify";
import { Pool } from "pg";
import { registerAgentBrowserRoutes } from "../../http/agent-browser.js";
import { launchAgentBrowser } from "./engine.js";
import { browserViewStore } from "./store.js";
import { observeAgentBrowser } from "./observer.js";

export async function createAgentBrowserFixture(
  databaseUrl: string,
  origin: string,
) {
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)
  )
    throw new Error("Browser fixtures require a local database.");
  const schema = `browser_fixture_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`create schema ${schema}`);
  const db = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
  });
  const storageRoot = await mkdtemp(join(tmpdir(), "loomic-browser-fixture-"));
  const userId = randomUUID(),
    workspaceId = randomUUID(),
    taskId = randomUUID(),
    token = randomUUID();
  await db.query(
    "create table workspaces(id uuid primary key);create table app_users(id uuid primary key);create table agent_connector_permissions(workspace_id uuid,user_id uuid,connector_id text,enabled boolean)",
  );
  await db.query("insert into workspaces values($1)", [workspaceId]);
  await db.query("insert into app_users values($1)", [userId]);
  await db.query(
    await readFile(
      new URL(
        "../../local-db/migrations/20261107000001_agent_browser_views.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const app = Fastify();
  app.addHook("onRequest", async (request, reply) => {
    if (request.headers.origin && request.headers.origin !== origin)
      return reply.code(403).send({ error: "Unexpected fixture origin" });
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
      user: { id: userId, email: "browser@example.test" },
    },
  }));
  registerAgentBrowserRoutes(app, {
    db,
    storageRoot,
    enabled: true,
    auth: {
      authenticate: async (request: FastifyRequest) =>
        request.headers.authorization === `Bearer ${token}`
          ? { id: userId }
          : null,
    } as never,
    viewerService: {
      ensureViewer: async () => ({ workspace: { id: workspaceId } }),
    } as never,
  });
  await app.listen({ port: 3313, host: "127.0.0.1" });
  const { browser, engine } = await launchAgentBrowser();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  await page.setContent(
    '<html><head><title>Agent 操作验收</title></head><body style="font:24px system-ui;padding:50px"><h1>真实隔离浏览器</h1><p id="state">等待 Agent</p><input aria-label="搜索内容" placeholder="搜索内容"><button id="search" onclick="document.querySelector(\'#state\').textContent=\'搜索完成：\'+document.querySelector(\'input\').value">搜索</button></body></html>',
  );
  const store = browserViewStore(db, storageRoot);
  const observer = await observeAgentBrowser({
    page,
    store,
    taskId,
    userId,
    workspaceId,
    engine,
    assertActive: async () => {},
  });
  await observer.pointAt("h1", "读取标题");
  await observer.capture();
  return {
    app,
    db,
    store,
    page,
    observer,
    taskId,
    userId,
    token,
    engine,
    workspaceId,
    async close() {
      await observer.close("completed", "验收完成");
      await browser.close();
      await app.close();
      await db.end();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
      await rm(storageRoot, { recursive: true, force: true });
    },
  };
}
