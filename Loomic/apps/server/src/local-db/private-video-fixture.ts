import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { Pool } from "pg";
import { registerPrivateVideoRoutes } from "../http/private-video.js";
import { registerLocalAssetRoutes } from "../http/local-assets.js";
import { createLocalStorageProvider } from "../storage/local-storage-provider.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";

export async function createPrivateVideoFixture(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) throw new Error("Video test database must be local.");
  const schema = `video_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`create schema ${schema}`);
  const db = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` });
  const root = await mkdtemp(join(tmpdir(), "loomic-private-video-"));
  const app = Fastify();
  const userId = randomUUID(), workspaceId = randomUUID(), projectId = randomUUID(), canvasId = randomUUID(), sessionId = randomUUID();
  const token = randomUUID();
  const colleagueId = randomUUID(), colleagueToken = randomUUID();
  const auth = { authenticate: async (request: { headers: { authorization?: string } }) => {
    const id = request.headers.authorization === `Bearer ${token}` ? userId : request.headers.authorization === `Bearer ${colleagueToken}` ? colleagueId : null;
    return id ? { id, accessToken: id === userId ? token : colleagueToken, email: "fixture@example.test", userMetadata: {} } : null;
  } };
  async function close() {
    await app.close();
    await db.end();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
  }
  try {
    const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
    await db.query(sql);
    await db.query("insert into app_users(id,email) values($1,'fixture@example.test')", [userId]);
    await db.query("insert into workspaces(id,owner_user_id,name) values($1,$2,'Video integration')", [workspaceId,userId]);
    await db.query("insert into workspace_members(workspace_id,user_id) values($1,$2)", [workspaceId,userId]);
    await db.query("insert into app_users(id,email) values($1,'colleague@example.test')", [colleagueId]);
    await db.query("insert into workspace_members(workspace_id,user_id) values($1,$2)", [workspaceId,colleagueId]);
    await db.query("insert into projects(id,workspace_id,created_by,name,slug) values($1,$2,$3,'Video acceptance','video-acceptance')", [projectId,workspaceId,userId]);
    await db.query("insert into canvases(id,project_id,created_by,name) values($1,$2,$3,'Video results')", [canvasId,projectId,userId]);
    await db.query("insert into chat_sessions(id,canvas_id,created_by,thread_id,title) values($1,$2,$3,$4,'Export acceptance')", [sessionId,canvasId,userId,sessionId]);
    await app.register(multipart);
    registerPrivateVideoRoutes(app, { auth, db, storage: createLocalStorageProvider({ rootDir: root }),
      viewerService: { ensureViewer: async () => ({ workspace: { id: workspaceId, name: "Video integration", type: "personal", ownerUserId: userId }, profile: { id: userId, email: "fixture@example.test", displayName: "Fixture" }, membership: { workspaceId, userId, role: "owner" }, isSystemAdmin: false }) } satisfies ViewerService });
    registerLocalAssetRoutes(app, { auth, db, root });
    await app.ready();
    return { app, db, root, token, userId, colleagueToken, colleagueId, workspaceId, sessionId, close };
  } catch (error) { await close(); throw error; }
}
