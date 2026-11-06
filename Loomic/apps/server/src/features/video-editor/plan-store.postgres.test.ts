import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createEditorPlanStore } from "./plan-store.js";
import type { VideoEditorPlan, VideoEditorPlanRequest } from "@helstera/shared";

describe.skipIf(!process.env.HELT_TEST_DATABASE_URL)("video editor approvals with PostgreSQL", () => {
  it("binds owner, revision, action set and expiry; retries never create another plan", async () => {
    const url = new URL(process.env.HELT_TEST_DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Only isolated local PostgreSQL is allowed.");
    const admin = new Pool({ connectionString: url.href });
    const schema = `editor_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`create schema ${schema}`);
    const db = new Pool({ connectionString: url.href, options: `-c search_path=${schema}` });
    try {
      await db.query("create table app_users(id uuid primary key); create table workspaces(id uuid primary key)");
      await db.query(await readFile(new URL("../../local-db/migrations/20261106000000_video_editor_plans.sql", import.meta.url), "utf8"));
      await db.query(await readFile(new URL("../../local-db/migrations/20261106000001_video_editor_receipts.sql", import.meta.url), "utf8"));
      const userId = randomUUID(), workspaceId = randomUUID();
      await db.query("insert into app_users values($1)", [userId]);
      await db.query("insert into workspaces values($1)", [workspaceId]);
      const store = createEditorPlanStore(db);
      const input: VideoEditorPlanRequest = { prompt: "add captions", projectId: "p", compositionId: "MyComp", revision: "a".repeat(64), compositionDuration: 2, media: [] };
      const plan: VideoEditorPlan = { summary: "captions", actions: [{ type: "caption", text: "中文", startMs: 0, endMs: 1000 }, { type: "export", format: "mp4" }] };
      const approval = await store.save(userId, workspaceId, input, plan);
      const confirm = { revision: input.revision!, fingerprint: approval.fingerprint, actions: [0, 1] };
      await expect(store.confirm(randomUUID(), approval.id, confirm)).rejects.toThrow();
      await expect(store.confirm(userId, approval.id, { ...confirm, revision: "b".repeat(64) })).rejects.toThrow();
      await expect(store.confirm(userId, approval.id, { ...confirm, fingerprint: "b".repeat(64) })).rejects.toThrow();
      await expect(store.confirm(userId, approval.id, { ...confirm, actions: [0] })).rejects.toThrow();
      for (const actions of [[], [0, 0, 1], [0, 2], [-1, 0, 1], [0.5, 1]]) {
        await expect(store.confirm(userId, approval.id, { ...confirm, actions })).rejects.toThrow();
      }
      await expect(store.complete(userId, approval.id, approval.fingerprint)).rejects.toThrow();
      expect((await store.confirm(userId, approval.id, { ...confirm, actions: [1, 0] })).id).toBe(approval.id);
      const confirmations = await Promise.all([store.confirm(userId, approval.id, confirm), store.confirm(userId, approval.id, confirm)]);
      expect(confirmations.map(item => item.id)).toEqual([approval.id, approval.id]);
      await expect(store.complete(userId, approval.id, approval.fingerprint, { previewId: randomUUID(), name: "too-early.mp4" })).rejects.toThrow();
      await store.complete(userId, approval.id, approval.fingerprint);
      await store.complete(userId, approval.id, approval.fingerprint);
      expect((await db.query("select status from video_editor_plans where id=$1", [approval.id])).rows[0].status).toBe("approved");
      const output = { previewId: randomUUID(), name: "approved-edit.mp4" };
      await store.complete(userId, approval.id, approval.fingerprint, output);
      await store.complete(userId, approval.id, approval.fingerprint, output);
      await expect(store.complete(userId, approval.id, approval.fingerprint, { ...output, previewId: randomUUID() })).rejects.toThrow();
      await expect(store.confirm(userId, approval.id, confirm)).rejects.toThrow();
      const expired = await store.save(userId, workspaceId, input, plan);
      await db.query("update video_editor_plans set expires_at=now()-interval '1 second' where id=$1", [expired.id]);
      await expect(store.confirm(userId, expired.id, { ...confirm, fingerprint: expired.fingerprint })).rejects.toThrow();
      expect((await db.query("select count(*)::int as count from video_editor_plans where status='completed'")).rows[0].count).toBe(1);
    } finally {
      await db.end();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    }
  });
});
