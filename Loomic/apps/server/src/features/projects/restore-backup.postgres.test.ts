import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerProjectBackupRoutes } from "../../http/project-backups.js";

describe.skipIf(!process.env.HELT_TEST_DATABASE_URL)("local snapshot restoration", () => {
  it("restores drawings and history atomically, deduplicates retries, and checks account ownership", async () => {
    const url = new URL(process.env.HELT_TEST_DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Local PostgreSQL only");
    const admin = new Pool({ connectionString: url.href });
    const schema = `restore_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`create schema ${schema}`);
    const db = new Pool({ connectionString: url.href, options: `-c search_path=${schema},public` });
    const app = Fastify();
    try {
      await db.query(await readFile(new URL("../../local-db/schema.sql", import.meta.url), "utf8"));
      const userId = randomUUID(), workspaceId = randomUUID(), assetId = randomUUID();
      await db.query("insert into app_users(id,email) values($1,'restore@test.invalid')", [userId]);
      await db.query("insert into workspaces(id,owner_user_id,name) values($1,$2,'restore')", [workspaceId, userId]);
      await db.query("insert into workspace_members(workspace_id,user_id) values($1,$2)", [workspaceId, userId]);
      await db.query("insert into asset_objects(id,workspace_id,created_by,bucket,object_path,mime_type) values($1,$2,$3,'private-video','movie.webm','video/webm')", [assetId, workspaceId, userId]);
      registerProjectBackupRoutes(app, { db, auth: { authenticate: async (req: { headers: { authorization?: string } }) => req.headers.authorization ? { id: userId } : null }, viewerService: { ensureViewer: async () => ({ workspace: { id: workspaceId } }) } } as never);
      const snapshot = { format: "helstera-project-backup", formatVersion: 1, project: { id: randomUUID(), name: "已保存工程", workspace: { ownerUserId: userId } },
        canvas: { id: randomUUID(), content: { elements: [{ id: "drawing", type: "text", text: "恢复内容" }], files: {}, appState: {} } },
        sessions: [{ id: randomUUID(), title: "历史对话", messages: [{ id: randomUUID(), role: "assistant", content: "已完成", createdAt: "2026-10-01T00:00:00.000Z", contentBlocks: [{ type: "tool", toolCallId: "old", toolName: "generate_image", status: "completed", outputSummary: "完成" }] }] }] };
      const send = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/project-backups/restore", headers: { authorization: "local" }, payload });
      expect((await app.inject({ method: "POST", url: "/api/project-backups/restore", payload: {} })).statusCode).toBe(401);
      expect((await send({ snapshot: {} })).statusCode).toBe(400);
      const replies = await Promise.all([send({ snapshot }), send({ snapshot })]);
      for (const response of replies) expect(response.statusCode, response.body).toBe(200);
      expect(new Set(replies.map(r => r.json().data.projectId)).size).toBe(1);
      expect((await db.query("select count(*)::int as count from projects")).rows[0].count).toBe(1);
      const restored = replies[0]!.json().data;
      expect((await db.query("select content from canvases where id=$1", [restored.canvasId])).rows[0].content.elements[0].text).toBe("恢复内容");
      const message = (await db.query("select content,content_blocks,created_at from chat_messages")).rows[0];
      expect(message.content).toBe("已完成"); expect(message.content_blocks[0].type).toBe("text");
      expect(message.created_at.toISOString()).toBe("2026-10-01T00:00:00.000Z");
      const missing = structuredClone(snapshot); missing.project.id = randomUUID(); missing.canvas.content.elements.push({ id: "missing", type: "text", text: `/api/uploads/${randomUUID()}/file` });
      expect((await send({ snapshot: missing })).statusCode).toBe(409);
      expect((await db.query("select count(*)::int as count from projects")).rows[0].count).toBe(1);
      const wrongOwner = structuredClone(snapshot); wrongOwner.project.workspace.ownerUserId = randomUUID();
      expect((await send({ snapshot: wrongOwner })).statusCode).toBe(403);
      const original = randomUUID(); missing.canvas.content.elements[1]!.text = `/api/uploads/${original}/file`;
      const replaced = await send({ snapshot: missing, replacements: { [original]: assetId } });
      expect(replaced.statusCode, replaced.body).toBe(200);
      expect(JSON.stringify((await db.query("select content from canvases where id=$1", [replaced.json().data.canvasId])).rows[0].content)).toContain(assetId);
      await db.query("create function fail_restore_message() returns trigger language plpgsql as $$ begin raise exception 'rollback fixture'; end $$; create trigger fail_restore before insert on chat_messages for each row execute function fail_restore_message()");
      const interrupted = structuredClone(snapshot); interrupted.project.id = randomUUID();
      expect((await send({ snapshot: interrupted })).statusCode).toBe(500);
      expect((await db.query("select count(*)::int as count from projects")).rows[0].count).toBe(2);
      expect((await db.query("select count(*)::int as count from canvases")).rows[0].count).toBe(2);
    } finally { await app.close(); await db.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); }
  });
});
