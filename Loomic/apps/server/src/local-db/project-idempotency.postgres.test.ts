import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalProjectService } from "./project-service.js";
import { registerProjectRoutes } from "../http/projects.js";

const databaseUrl = process.env.HELT_TEST_DATABASE_URL ?? process.env.HELT_PROJECT_DB_URL ?? "";
const enabled = Boolean(databaseUrl) && (Boolean(process.env.HELT_TEST_DATABASE_URL) || process.env.HELT_PROJECT_DB_TEST === "1");
const user = { id: "123e4567-e89b-42d3-a456-426614174000", accessToken: "test", email: "", userMetadata: {} };
const schema = `project_test_${randomUUID().replaceAll("-", "")}`;
let admin: Pool;
let db: Pool;

describe.skipIf(!enabled)("PostgreSQL project creation idempotency", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) throw new Error("Project database tests require localhost.");
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`create schema ${schema}`);
    db = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await db.query(`
      create table workspaces (id text primary key default gen_random_uuid()::text, owner_user_id text, name text);
      create table workspace_members (workspace_id text, user_id text, role text, unique (workspace_id, user_id));
      create table brand_kits (id text, user_id text, is_default boolean);
      create table projects (id text primary key default gen_random_uuid()::text, workspace_id text, created_by text, name text, slug text, description text, source text, brand_kit_id text, created_at timestamptz default now(), updated_at timestamptz default now());
      create table canvases (id text primary key default gen_random_uuid()::text, project_id text, created_by text, name text, is_primary boolean);
      insert into workspaces (id, owner_user_id, name) values ('123e4567-e89b-42d3-a456-426614174001', '123e4567-e89b-42d3-a456-426614174000', 'Personal');
    `);
    const migration = await readFile(new URL("./migrations/20261103000001_project_creation_requests.sql", import.meta.url), "utf8");
    await db.query(migration);
    await db.query(migration);
  }, 30_000);

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`drop schema if exists ${schema} cascade`);
      await admin.end();
    }
  });

  it("returns one project across concurrent instances and service restart", async () => {
    const first = createLocalProjectService(db);
    const second = createLocalProjectService(db);
    const [a, b] = await Promise.all([
      first.createProjectIdempotent!(user, { name: "Try on" }, "same-key"),
      second.createProjectIdempotent!(user, { name: "Try on" }, "same-key"),
    ]);
    expect(a.id).toBe(b.id);
    const restarted = createLocalProjectService(db);
    expect((await restarted.createProjectIdempotent!(user, { name: "Try on" }, "same-key")).id).toBe(a.id);
    await expect(restarted.createProjectIdempotent!(user, { name: "Other" }, "same-key")).rejects.toMatchObject({ code: "project_idempotency_conflict", statusCode: 409 });
    expect(Number((await db.query("select count(*) from projects")).rows[0].count)).toBe(1);
    expect(Number((await db.query("select count(*) from canvases")).rows[0].count)).toBe(1);
  }, 30_000);

  it("enforces the same key and payload at the HTTP boundary", async () => {
    const app = Fastify();
    await registerProjectRoutes(app, {
      auth: { authenticate: async () => user },
      projectService: createLocalProjectService(db),
    });
    try {
      const send = (name: string) => app.inject({ method: "POST", url: "/api/projects", headers: { "idempotency-key": "http-key" }, payload: { name } });
      const first = await send("HTTP project");
      const second = await send("HTTP project");
      const changed = await send("Different project");
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(second.json().project.id).toBe(first.json().project.id);
      expect(changed.statusCode).toBe(409);
      expect(changed.json().error.code).toBe("project_idempotency_conflict");
    } finally {
      await app.close();
    }
  }, 30_000);

  it("keeps the same idempotency key isolated between users", async () => {
    const other = { ...user, id: "123e4567-e89b-42d3-a456-426614174002" };
    await db.query("insert into workspaces (id, owner_user_id, name) values ($1, $2, $3)", ["123e4567-e89b-42d3-a456-426614174003", other.id, "Other"]);
    const service = createLocalProjectService(db);
    const a = await service.createProjectIdempotent!(user, { name: "First user" }, "shared-key");
    const b = await service.createProjectIdempotent!(other, { name: "Second user" }, "shared-key");
    expect(a.id).not.toBe(b.id);
    expect(a.workspace.id).not.toBe(b.workspace.id);
    expect((await service.createProjectIdempotent!(other, { name: "Second user" }, "shared-key")).id).toBe(b.id);
  });

  it("rolls back the project and key if canvas creation fails", async () => {
    await db.query(`create function reject_canvas_for_test() returns trigger language plpgsql as $$
      begin raise exception 'canvas creation failed'; end $$`);
    await db.query("create trigger reject_canvas_for_test before insert on canvases for each row execute function reject_canvas_for_test()");
    const service = createLocalProjectService(db);
    try {
      await expect(service.createProjectIdempotent!(user, { name: "Rollback test" }, "rollback-key")).rejects.toMatchObject({ code: "project_create_failed" });
      expect(Number((await db.query("select count(*) from projects where name = $1", ["Rollback test"])).rows[0].count)).toBe(0);
      expect(Number((await db.query("select count(*) from project_creation_requests where request_key = $1", ["rollback-key"])).rows[0].count)).toBe(0);
    } finally {
      await db.query("drop trigger reject_canvas_for_test on canvases");
      await db.query("drop function reject_canvas_for_test()");
    }
    const recovered = await service.createProjectIdempotent!(user, { name: "Rollback test" }, "rollback-key");
    expect((await service.createProjectIdempotent!(user, { name: "Rollback test" }, "rollback-key")).id).toBe(recovered.id);
  });
});
