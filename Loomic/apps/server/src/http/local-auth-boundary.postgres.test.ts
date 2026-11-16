import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalRequestAuthenticator,
  hashPassword,
  hashToken,
  issueVerificationCode,
} from "../local-db/auth.js";
import { registerLocalAuthRoutes } from "./local-auth.js";

describe.skipIf(!process.env.HELT_TEST_DATABASE_URL)(
  "local auth transactional boundary",
  () => {
    const schema = `auth_boundary_${randomUUID().replaceAll("-", "")}`;
    const email = "owner@auth-boundary.test";
    const oldPassword = "test-old-password";
    let db: Pool;
    let admin: Pool;
    const app = Fastify();

    beforeAll(async () => {
      const url = new URL(process.env.HELT_TEST_DATABASE_URL ?? "");
      if (url.hostname !== "127.0.0.1")
        throw new Error("Auth tests require loopback PostgreSQL");
      admin = new Pool({ connectionString: url.href });
      await admin.query(`create schema ${schema}`);
      db = new Pool({
        connectionString: url.href,
        options: `-c search_path=${schema},public`,
      });
      await db.query(
        await readFile(
          new URL("../local-db/schema.sql", import.meta.url),
          "utf8",
        ),
      );
      registerLocalAuthRoutes(app, {
        db,
        env: { webOrigin: "https://studio.example.test" } as never,
      });
      await app.ready();
    });

    beforeEach(async () => {
      await db.query("truncate app_users cascade");
      await db.query(
        "insert into app_users(email,password_hash) values($1,$2)",
        [email, await hashPassword(oldPassword)],
      );
    });

    afterAll(async () => {
      await app.close();
      await db?.end();
      if (admin) {
        try {
          await admin.query(`drop schema if exists ${schema} cascade`);
        } finally {
          await admin.end();
        }
      }
    });

    const reset = (code: string) =>
      app.inject({
        method: "POST",
        url: "/api/local-auth/reset-password",
        payload: { email, code, password: "test-new-password" },
      });
    async function sessionToken(emailAddress = email) {
      const token = randomUUID();
      await db.query(
        "insert into sessions(user_id,token_hash,expires_at) select id,$2,now()+interval '1 day' from app_users where email=$1",
        [emailAddress, hashToken(token)],
      );
      return token;
    }

    it("rolls back code consumption and session creation when updating the password fails", async () => {
      const code = await issueVerificationCode(db, email);
      if (!code) throw new Error("Fixture verification code was not issued");
      await db.query(`create function reject_password() returns trigger language plpgsql as $$ begin raise exception 'private reset diagnostic'; end $$;
      create trigger reject_password before update of password_hash on app_users for each row execute function reject_password()`);
      try {
        const response = await reset(code);
        expect(response.statusCode).toBe(500);
        expect(response.headers["set-cookie"]).toBeUndefined();
        expect(
          (await db.query("select count(*)::int as count from sessions"))
            .rows[0].count,
        ).toBe(0);
        expect(
          (await db.query("select used_at from email_verification_codes"))
            .rows[0].used_at,
        ).toBeNull();
        expect(response.body).not.toContain("private reset diagnostic");
      } finally {
        await db.query(
          "drop trigger reject_password on app_users; drop function reject_password()",
        );
      }
      expect((await reset(code)).statusCode).toBe(200);
      expect((await reset(code)).statusCode).toBe(401);
    });

    it("rolls back the password update if the new session cannot be saved", async () => {
      const code = await issueVerificationCode(db, email);
      if (!code) throw new Error("Fixture verification code was not issued");
      await db.query(`create function reject_auth_session() returns trigger language plpgsql as $$ begin raise exception 'session unavailable'; end $$;
      create trigger reject_auth_session before insert on sessions for each row execute function reject_auth_session()`);
      try {
        expect((await reset(code)).statusCode).toBe(500);
        expect(
          (await db.query("select used_at from email_verification_codes"))
            .rows[0].used_at,
        ).toBeNull();
        const password = (
          await db.query("select password_hash from app_users where email=$1", [
            email,
          ])
        ).rows[0].password_hash;
        expect(password).not.toBeNull();
      } finally {
        await db.query(
          "drop trigger reject_auth_session on sessions; drop function reject_auth_session()",
        );
      }
      const oldLogin = await app.inject({
        method: "POST",
        url: "/api/local-auth/password",
        payload: { email, password: oldPassword },
      });
      expect(oldLogin.statusCode).toBe(200);
      expect((await reset(code)).statusCode).toBe(200);
    });

    it("allows only one reset to consume a verification code under concurrency", async () => {
      const code = await issueVerificationCode(db, email);
      if (!code) throw new Error("Fixture verification code was not issued");
      const replies = await Promise.all([reset(code), reset(code)]);
      expect(replies.map((reply) => reply.statusCode).sort()).toEqual([
        200, 401,
      ]);
      expect(
        (await db.query("select count(*)::int as count from sessions")).rows[0]
          .count,
      ).toBe(1);
      expect(
        replies.find((reply) => reply.statusCode === 401)?.headers[
          "set-cookie"
        ],
      ).toBeUndefined();
    });

    it("revokes the same bearer session accepted by normal API authentication", async () => {
      const token = await sessionToken();
      const headers = { authorization: `Bearer ${token}` };
      const authenticator = createLocalRequestAuthenticator(db);
      expect(await authenticator.authenticate({ headers })).not.toBeNull();
      const response = await app.inject({
        method: "POST",
        url: "/api/local-auth/sign-out",
        headers,
      });
      expect(response.statusCode).toBe(204);
      expect(await authenticator.authenticate({ headers })).toBeNull();
      expect(response.headers["set-cookie"]).toContain("Max-Age=0");
      expect(response.headers["cache-control"]).toContain("no-store");
    });

    it("reads bearer session state and keeps cookie identity precedence for logout", async () => {
      const cookieToken = await sessionToken();
      const bearerToken = await sessionToken();
      const bearer = await app.inject({
        url: "/api/local-auth/session",
        headers: { authorization: `Bearer ${bearerToken}` },
      });
      expect(bearer.json().session.user.email).toBe(email);
      expect(bearer.headers["cache-control"]).toContain("no-store");
      await app.inject({
        method: "POST",
        url: "/api/local-auth/sign-out",
        headers: {
          cookie: `helstera_session=${cookieToken}`,
          authorization: `Bearer ${bearerToken}`,
        },
      });
      const hashes = (
        await db.query("select token_hash from sessions")
      ).rows.map((row) => row.token_hash);
      expect(hashes).toEqual([hashToken(bearerToken)]);
    });

    it.each([
      ["send-code", { email: 123 }],
      ["verify-code", { email, code: [] }],
      ["password", { email, password: {} }],
      ["reset-password", { email, code: "123456", password: [] }],
      ["exchange", { token: 123 }],
      ["desktop-confirm", { state: [] }],
      ["desktop-exchange", { token: {} }],
      ["magic-link", { email: {} }],
    ])("rejects invalid %s body at the boundary", async (route, body) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/local-auth/${route}`,
        payload: body,
      });
      expect(response.statusCode).toBe(400);
      expect(
        (await db.query("select count(*)::int as count from sessions")).rows[0]
          .count,
      ).toBe(0);
    });
  },
);
