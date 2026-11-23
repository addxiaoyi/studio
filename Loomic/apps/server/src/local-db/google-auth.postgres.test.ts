import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoogleAuthStore } from "./google-auth.js";
const databaseUrl = process.env.HELT_TEST_DATABASE_URL;
const schema = `google_auth_${randomUUID().replaceAll("-", "")}`;
let admin: Pool;
let db: Pool;
describe.skipIf(!databaseUrl)("Google account storage", () => {
  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Local test database is not configured");
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(databaseUrl).hostname,
      )
    )
      throw Error("Google auth tests require a local database");
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`create schema ${schema}`);
    db = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema}`,
    });
    await db.query(
      await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
    const migration = await readFile(
      new URL(
        "./migrations/20261123000000_google_sign_in.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.query(migration);
    await db.query(migration);
  });
  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`drop schema if exists ${schema} cascade`);
      await admin.end();
    }
  });
  it("consumes a browser-bound authorization only once under concurrent callbacks", async () => {
    const store = createGoogleAuthStore(db);
    await store.saveState({
      state: "state",
      browser: "browser",
      nonce: "nonce",
      verifier: "verifier",
      returnTo: "/home/",
    });
    expect(await store.consumeState("state", "wrong-browser")).toBeNull();
    const reads = await Promise.all([
      store.consumeState("state", "browser"),
      store.consumeState("state", "browser"),
    ]);
    expect(reads.filter(Boolean)).toHaveLength(1);
  });
  it("rejects expired authorizations in the database", async () => {
    const store = createGoogleAuthStore(db);
    await store.saveState({
      state: "expired",
      browser: "browser",
      nonce: "nonce",
      verifier: "verifier",
      returnTo: "/home/",
    });
    await db.query(
      "update google_login_states set expires_at = now() - interval '1 second'",
    );
    expect(await store.consumeState("expired", "browser")).toBeNull();
  });
  it("preserves an existing authoritative mailbox account and its balance", async () => {
    const userId = randomUUID();
    await db.query("insert into app_users(id,email) values($1,$2)", [
      userId,
      "existing@gmail.com",
    ]);
    const workspaceId = randomUUID();
    await db.query(
      "insert into workspaces(id,owner_user_id,name) values($1,$2,'Existing workspace')",
      [workspaceId, userId],
    );
    await db.query(
      "insert into credit_balances(workspace_id,balance) values($1,187.25)",
      [workspaceId],
    );
    const identity = {
      subject: "existing-subject",
      email: "existing@gmail.com",
      authoritativeEmail: true,
    };
    const store = createGoogleAuthStore(db);
    const sessions = await Promise.all([
      store.signIn(identity),
      store.signIn(identity),
    ]);
    expect(sessions.map((session) => session.userId)).toEqual([userId, userId]);
    expect(
      (
        await db.query(
          "select count(*)::int as n from google_identities where user_id=$1",
          [userId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      Number(
        (
          await db.query(
            "select balance from credit_balances where workspace_id=$1",
            [workspaceId],
          )
        ).rows[0].balance,
      ),
    ).toBe(187.25);
  });
  it("requires local authentication before linking an existing external email", async () => {
    const userId = randomUUID();
    await db.query("insert into app_users(id,email) values($1,$2)", [
      userId,
      "member@example.com",
    ]);
    const store = createGoogleAuthStore(db);
    const identity = {
      subject: "external-subject",
      email: "member@example.com",
      authoritativeEmail: false,
    };
    await expect(store.signIn(identity)).rejects.toMatchObject({
      code: "google_link_required",
    });
    expect(
      (
        await db.query(
          "select count(*)::int as n from sessions where user_id=$1",
          [userId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect((await store.signIn(identity, userId)).userId).toBe(userId);
    expect(
      (await store.signIn({ ...identity, email: "changed@example.com" }))
        .userId,
    ).toBe(userId);
  });
  it("never moves a Google identity onto another signed-in account", async () => {
    const store = createGoogleAuthStore(db);
    const identity = {
      subject: "fixed-subject",
      email: "new@gmail.com",
      authoritativeEmail: true,
    };
    const original = await store.signIn(identity);
    const other = randomUUID();
    await db.query("insert into app_users(id,email) values($1,$2)", [
      other,
      "other@gmail.com",
    ]);
    await expect(store.signIn(identity, other)).rejects.toMatchObject({
      code: "google_account_conflict",
    });
    expect((await store.signIn(identity)).userId).toBe(original.userId);
  });
  it("does not create duplicate users when new account sign-ins arrive together", async () => {
    const identity = {
      subject: "new-concurrent",
      email: "fresh@gmail.com",
      authoritativeEmail: true,
    };
    const sessions = await Promise.all(
      Array.from({ length: 4 }, () =>
        createGoogleAuthStore(db).signIn(identity),
      ),
    );
    expect(new Set(sessions.map((session) => session.userId)).size).toBe(1);
    expect(
      (
        await db.query(
          "select count(*)::int as n from app_users where email=$1",
          [identity.email],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("requires proof of a non-Google mailbox before creating its first linked account", async () => {
    await expect(
      createGoogleAuthStore(db).signIn({
        subject: "untrusted-external",
        email: "unclaimed@example.com",
        authoritativeEmail: false,
      }),
    ).rejects.toMatchObject({ code: "google_link_required" });
    expect(
      (
        await db.query(
          "select count(*)::int as n from app_users where email=$1",
          ["unclaimed@example.com"],
        )
      ).rows[0].n,
    ).toBe(0);
  });
});
