import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { Pool } from "pg";
import { loadServerEnv } from "../../config/env.js";
import { registerLocalAuthRoutes } from "../../http/local-auth.js";
import { registerVideoEditorRoutes } from "../../http/video-editor.js";
import { createLocalRequestAuthenticator, hashPassword } from "../../local-db/auth.js";
import { createLocalSettingsService } from "../../local-db/settings-service.js";
import { createLocalViewerService } from "../../local-db/viewer-service.js";
import { createEditorPlanStore } from "./plan-store.js";
import { registerProjectContextRoutes } from "../../http/project-context.js";
import { registerProjectVideoRoutes } from "../../http/project-video-document.js";

export async function createEditorBrowserFixture(databaseUrl: string, webOrigin: string, modelText?: string | ((input: Record<string, unknown>)=>unknown)) {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname)) throw new Error("Video acceptance requires a local database.");
  const schema = `video_browser_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`create schema ${schema}`);
  const db = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const app = Fastify({ logger: {
    level: "info",
    serializers: { err: (error: Error & { status?: number; code?: string }) => ({
      type: error.name, stack: "", status: error.status, code: error.code,
      message: [process.env.OPENAI_API_KEY, process.env.GOOGLE_API_KEY]
        .filter((key): key is string => Boolean(key))
        .reduce((message, key) => message.replaceAll(key, "[redacted]"), error.message),
    }) },
  } });
  const email = "video-editor@example.test";
  const password = randomBytes(24).toString("base64url");
  const close = async () => {
    await app.close();
    await db.end();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  };
  try {
    const base = await readFile(new URL("../../local-db/schema.sql", import.meta.url), "utf8");
    await db.query(base.replace("create extension if not exists pgcrypto;", ""));
    await db.query(await readFile(new URL("../../local-db/migrations/20261110000001_project_context.sql", import.meta.url),"utf8"));
    await db.query(await readFile(new URL("../../local-db/migrations/20261110000002_project_video_documents.sql", import.meta.url),"utf8"));
    await db.query(await readFile(new URL("../../local-db/migrations/20261106000000_video_editor_plans.sql", import.meta.url), "utf8"));
    await db.query(await readFile(new URL("../../local-db/migrations/20261106000001_video_editor_receipts.sql", import.meta.url), "utf8"));
    const userId = randomUUID();
    await db.query("insert into app_users(id,email,password_hash) values($1,$2,$3)", [userId, email, await hashPassword(password)]);
    const env = loadServerEnv({ webOrigin });
    app.addHook("onRequest", async (request, reply) => {
      if (request.headers.origin && request.headers.origin !== webOrigin) return reply.code(403).send({ error: "Unexpected test origin" });
      reply.header("Access-Control-Allow-Origin", webOrigin).header("Access-Control-Allow-Credentials", "true").header("Access-Control-Allow-Headers", "authorization,content-type").header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
      if (request.method === "OPTIONS") return reply.code(204).send();
    });
    registerLocalAuthRoutes(app, { db, env });
    registerProjectContextRoutes(app,{db,auth:createLocalRequestAuthenticator(db)});
    registerProjectVideoRoutes(app,{db,auth:createLocalRequestAuthenticator(db)});
    registerVideoEditorRoutes(app, { env, auth: createLocalRequestAuthenticator(db), settingsService: createLocalSettingsService(db), viewerService: createLocalViewerService(db), planStore: createEditorPlanStore(db),
      ...(modelText === undefined ? {} : { createPlanModel: () => ({ invoke: async (messages: {content:string}[]) => ({ content: typeof modelText==="string"?modelText:JSON.stringify(modelText(JSON.parse(messages[1]!.content))) }) }) as never }) });
    await app.listen({ host: "127.0.0.1", port: 3311 });
    return { email, password, userId, db, close };
  } catch (error) {
    await close();
    throw error;
  }
}
