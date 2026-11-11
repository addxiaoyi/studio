import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerLocalAuthRoutes } from "./local-auth.js";
import { issueVerificationCode, verifyVerificationCode } from "../local-db/auth.js";

const databaseUrl = process.env.HELT_TEST_DATABASE_URL ?? process.env.HELT_AUTH_DB_URL ?? "";
const enabled = Boolean(databaseUrl) && (Boolean(process.env.HELT_TEST_DATABASE_URL) || process.env.HELT_AUTH_DB_TEST === "1");
const schema = `auth_test_${randomUUID().replaceAll("-", "")}`;
let admin: Pool;
let db: Pool;
let app: ReturnType<typeof Fastify>;

describe.skipIf(!enabled)("registration with PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
      throw new Error("Auth database tests require localhost.");
    }
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`create schema ${schema}`);
    db = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await db.query(`
      create table app_users (id uuid primary key default gen_random_uuid(), email text unique not null,
        password_hash text, updated_at timestamptz default now());
      create table sessions (user_id uuid not null, token_hash text not null, expires_at timestamptz not null);
      create table email_verification_codes (id uuid primary key default gen_random_uuid(), user_id uuid not null,
        code_hash text not null, attempts integer not null default 0, created_at timestamptz default now(), expires_at timestamptz not null, used_at timestamptz);
    `);
    app = Fastify();
    registerLocalAuthRoutes(app, { db, env: { webOrigin: "http://localhost" } as never });
  });

  afterAll(async () => {
    await app?.close();
    await db?.end();
    if (admin) {
      await admin.query(`drop schema if exists ${schema} cascade`);
      await admin.end();
    }
  });

  it("never replaces an existing password or creates a session for a duplicate registration", async () => {
    const email = "owner@example.test";
    const code = await issueVerificationCode(db, email);
    const first = await app.inject({ method: "POST", url: "/api/local-auth/register", payload: { email, code, password: "correct-password" } });
    expect(first.statusCode).toBe(200);
    await db.query("update email_verification_codes set created_at = now() - interval '2 minutes'");
    const freshCode = await issueVerificationCode(db, email);
    const duplicate = await app.inject({ method: "POST", url: "/api/local-auth/register", payload: { email: "OWNER@example.test", code: freshCode, password: "attacker-password" } });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("account_exists");
    expect(duplicate.headers["set-cookie"]).toBeUndefined();
    expect(Number((await db.query("select count(*) from sessions")).rows[0].count)).toBe(1);
    const signIn = (password: string) => app.inject({ method: "POST", url: "/api/local-auth/password", payload: { email, password } });
    expect((await signIn("attacker-password")).statusCode).toBe(401);
    expect((await signIn("correct-password")).statusCode).toBe(200);
  }, 30_000);

  it("allows only one concurrent registration for the same email", async () => {
    const code = await issueVerificationCode(db, "race@example.test");
    const register = (password: string) => app.inject({ method: "POST", url: "/api/local-auth/register", payload: { email: "race@example.test", code, password } });
    const responses = await Promise.all([register("password-first"), register("password-second")]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 400]);
    expect(responses.find((response) => response.statusCode === 400)?.headers["set-cookie"]).toBeUndefined();
    expect(Number((await db.query("select count(*) from app_users where email = $1", ["race@example.test"])).rows[0].count)).toBe(1);
  }, 30_000);

  it("issues only one verification code for concurrent requests", async () => {
    const email = "send-race@example.test";
    const codes = await Promise.all(Array.from({ length: 10 }, () => issueVerificationCode(db, email)));
    expect(codes.filter((code) => code !== null)).toHaveLength(1);
    const { rows } = await db.query("select count(*) from email_verification_codes c join app_users u on u.id = c.user_id where u.email = $1", [email]);
    expect(Number(rows[0].count)).toBe(1);
  }, 30_000);

  it("migrates existing verification codes idempotently", async () => {
    const client = await db.connect();
    try {
      await client.query("create temporary table email_verification_codes (id integer primary key)");
      await client.query("insert into email_verification_codes (id) values (1)");
      const migration = await readFile(new URL("../local-db/migrations/20261104000000_email_code_attempts.sql", import.meta.url), "utf8");
      await client.query(migration);
      await client.query(migration);
      const { rows } = await client.query("select attempts from email_verification_codes where id = 1");
      expect(rows[0].attempts).toBe(0);
    } finally {
      await client.query("drop table if exists pg_temp.email_verification_codes");
      client.release();
    }
  });

  it("rejects non-string registration fields", async () => {
    const response = await app.inject({ method: "POST", url: "/api/local-auth/register", payload: { email: 123, password: [] } });
    expect(response.statusCode).toBe(400);
  });

  it("rejects missing, incorrect, expired and replayed codes without issuing sessions", async () => {
    const email = "verify@example.test";
    const code = await issueVerificationCode(db, email);
    const register = (value?: string) => app.inject({ method: "POST", url: "/api/local-auth/register", payload: { email, password: "secure-password", code: value } });
    expect((await register()).statusCode).toBe(400);
    expect((await register("000000")).statusCode).toBe(400);
    await db.query("update email_verification_codes set expires_at = now() - interval '1 minute' where user_id = (select id from app_users where email = $1)", [email]);
    expect((await register(code!)).statusCode).toBe(400);
    expect(Number((await db.query("select count(*) from sessions where user_id = (select id from app_users where email = $1)", [email])).rows[0].count)).toBe(0);
    await db.query("update email_verification_codes set expires_at = now() + interval '1 minute' where user_id = (select id from app_users where email = $1)", [email]);
    expect((await register(code!)).statusCode).toBe(200);
    expect((await register(code!)).statusCode).toBe(400);
  }, 30_000);

  it("rolls back the password and code if session creation fails", async () => {
    const email = "rollback@example.test";
    const code = await issueVerificationCode(db, email);
    await db.query(`create function reject_test_session() returns trigger language plpgsql as $$
      begin raise exception 'session test failure'; end $$`);
    await db.query("create trigger reject_test_session before insert on sessions for each row execute function reject_test_session()");
    try {
      const response = await app.inject({ method: "POST", url: "/api/local-auth/register", payload: { email, password: "secure-password", code } });
      expect(response.statusCode).toBe(500);
      const { rows } = await db.query(`select u.password_hash, c.used_at from app_users u
        join email_verification_codes c on c.user_id = u.id where u.email = $1`, [email]);
      expect(rows[0].password_hash).toBeNull();
      expect(rows[0].used_at).toBeNull();
    } finally {
      await db.query("drop trigger reject_test_session on sessions");
    }
    const retry = await app.inject({ method: "POST", url: "/api/local-auth/register", payload: { email, password: "secure-password", code } });
    expect(retry.statusCode).toBe(200);
  }, 30_000);

  it("shares the attempt limit across registration and verification under concurrency", async () => {
    const email = "attempts@example.test";
    const code = await issueVerificationCode(db, email);
    const register = () => app.inject({ method: "POST", url: "/api/local-auth/register", payload: { email, password: "secure-password", code: "000000" } });
    await Promise.all([register(), register(), verifyVerificationCode(db, email, "000000"), verifyVerificationCode(db, email, "000000"), register()]);
    const attempts = await db.query("select c.attempts from email_verification_codes c join app_users u on u.id = c.user_id where u.email = $1", [email]);
    expect(attempts.rows[0].attempts).toBe(5);
    expect(await verifyVerificationCode(db, email, code!)).toBeNull();
    expect((await app.inject({ method: "POST", url: "/api/local-auth/register", payload: { email, password: "secure-password", code } })).statusCode).toBe(400);
    await db.query("update email_verification_codes set created_at = now() - interval '2 minutes' where user_id = (select id from app_users where email = $1)", [email]);
    const freshCode = await issueVerificationCode(db, email);
    expect(await verifyVerificationCode(db, email, freshCode!)).not.toBeNull();
  }, 30_000);

  it("never reactivates an older code after the latest code is consumed", async () => {
    const email = "superseded@example.test";
    const oldCode = await issueVerificationCode(db, email);
    await db.query("update email_verification_codes set created_at = now() - interval '2 minutes' where user_id = (select id from app_users where email = $1)", [email]);
    const freshCode = await issueVerificationCode(db, email);
    expect(await verifyVerificationCode(db, email, freshCode!)).not.toBeNull();
    expect(await verifyVerificationCode(db, email, oldCode!)).toBeNull();
  }, 30_000);
});
