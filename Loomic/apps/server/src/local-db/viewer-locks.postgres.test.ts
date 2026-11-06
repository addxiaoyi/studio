import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createLocalViewerService } from "./viewer-service.js";

describe.skipIf(!process.env.HELT_TEST_DATABASE_URL)("viewer bootstrap during media delivery", () => {
  it("does not lock existing identity keys while an upload holds workspace references", async () => {
    const url = new URL(process.env.HELT_TEST_DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Local PostgreSQL required.");
    const admin = new Pool({ connectionString: url.href });
    const schema = `viewer_locks_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`create schema ${schema}`);
    const db = new Pool({ connectionString: url.href, options: `-c search_path=${schema} -c statement_timeout=1500` });
    const upload = await db.connect();
    try {
      await db.query(`create table app_users(id uuid primary key,email text unique,display_name text,avatar_url text,system_role text default 'user',updated_at timestamptz default now());
        create table workspaces(id uuid primary key default gen_random_uuid(),owner_user_id uuid unique references app_users(id),name text);
        create table workspace_members(workspace_id uuid references workspaces(id),user_id uuid references app_users(id),role text,unique(workspace_id,user_id));
        create table asset_objects(id uuid primary key,workspace_id uuid references workspaces(id),created_by uuid references app_users(id));`);
      const user = { id: randomUUID(), email: "delivery@example.test", accessToken: "", userMetadata: {} };
      const service = createLocalViewerService(db);
      const [first, second] = await Promise.all([service.ensureViewer(user), service.ensureViewer(user)]);
      expect(second.workspace.id).toBe(first.workspace.id);
      await upload.query("begin");
      await upload.query("select id from workspaces where id=$1 for key share", [first.workspace.id]);
      const refreshed = await service.ensureViewer(user);
      expect(refreshed.workspace.id).toBe(first.workspace.id);
      await upload.query("insert into asset_objects values($1,$2,$3)", [randomUUID(),first.workspace.id,user.id]);
      await upload.query("commit");
      expect((await service.ensureViewer({ ...user, email: "updated@example.test" })).profile.email).toBe("updated@example.test");
      expect(Number((await db.query("select count(*) from workspaces")).rows[0].count)).toBe(1);
    } finally {
      await upload.query("rollback");upload.release();await db.end();
      await admin.query(`drop schema ${schema} cascade`);await admin.end();
    }
  });
});
