import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { Pool } from "pg";
import { loadServerEnv } from "../../config/env.js";
import { registerLocalAuthRoutes } from "../../http/local-auth.js";
import { registerOneTakeRoutes } from "../../http/onetake.js";
import { registerPrivateVideoRoutes } from "../../http/private-video.js";
import { registerLocalAssetRoutes } from "../../http/local-assets.js";
import { createLocalRequestAuthenticator, hashPassword } from "../../local-db/auth.js";
import { createLocalViewerService } from "../../local-db/viewer-service.js";
import { createLocalStorageProvider } from "../../storage/local-storage-provider.js";
import { startOneTakeWorker } from "./worker.js";

export async function createOneTakeBrowserFixture(databaseUrl: string, webOrigin: string) {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname)) throw new Error("OneTake acceptance requires local PostgreSQL.");
  const schema = `onetake_browser_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`create schema ${schema}`);
  const db = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const root = await mkdtemp(join(tmpdir(), "loomic-onetake-browser-"));
  const app = Fastify();
  let stopWorker: (() => Promise<void>) | undefined;
  const close = async () => { await stopWorker?.(); await app.close(); await db.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); await rm(root, { recursive: true, force: true }); };
  try {
    await db.query((await readFile(new URL("../../local-db/schema.sql", import.meta.url), "utf8")).replace("create extension if not exists pgcrypto;", ""));
    await db.query(await readFile(new URL("../../local-db/migrations/20261106000002_onetake_jobs.sql", import.meta.url), "utf8"));
    const userId = randomUUID(), email = "onetake@example.test", password = randomBytes(24).toString("base64url");
    await db.query("insert into app_users(id,email,password_hash) values($1,$2,$3)", [userId, email, await hashPassword(password)]);
    const workspaceId = randomUUID(), projectId = randomUUID(), canvasId = randomUUID(), sessionId = randomUUID();
    await db.query("insert into workspaces(id,owner_user_id,name) values($1,$2,'OneTake acceptance')", [workspaceId, userId]);
    await db.query("insert into workspace_members(workspace_id,user_id) values($1,$2)", [workspaceId, userId]);
    await db.query("insert into projects(id,workspace_id,created_by,name,slug) values($1,$2,$3,'OneTake acceptance','onetake-acceptance')", [projectId, workspaceId, userId]);
    await db.query("insert into canvases(id,project_id,created_by,name) values($1,$2,$3,'OneTake results')", [canvasId, projectId, userId]);
    await db.query("insert into chat_sessions(id,canvas_id,created_by,thread_id,title) values($1,$2,$3,$4,'Export acceptance')", [sessionId, canvasId, userId, sessionId]);
    const auth = createLocalRequestAuthenticator(db), viewerService = createLocalViewerService(db);
    const storage = createLocalStorageProvider({ rootDir: root });
    const env = loadServerEnv({ webOrigin });
    app.addHook("onRequest", async (request, reply) => {
      if (request.headers.origin && request.headers.origin !== webOrigin) return reply.code(403).send({ error: "Unexpected test origin" });
      reply.header("Access-Control-Allow-Origin", webOrigin).header("Access-Control-Allow-Credentials", "true").header("Access-Control-Allow-Headers", "authorization,content-type,idempotency-key").header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
      if (request.method === "OPTIONS") return reply.code(204).send();
    });
    await app.register(multipart);
    registerLocalAuthRoutes(app, { db, env });
    registerOneTakeRoutes(app, { db, auth, viewerService, storage, storageRoot: root });
    registerPrivateVideoRoutes(app, { db, auth, viewerService, storage });
    registerLocalAssetRoutes(app, { db, auth, root });
    await app.listen({ host: "127.0.0.1", port: 3312 });
    stopWorker = startOneTakeWorker(db, root);
    return { app, db, root, userId, sessionId, email, password, close };
  } catch (error) { await close(); throw error; }
}
