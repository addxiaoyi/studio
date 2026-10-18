import { createHash, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Pool } from "pg";
import type { FastifyRequest } from "fastify";
import type { AuthenticatedUser, RequestAuthenticator } from "../auth/types.js";

const TOKEN_TTL_MS = 15 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RESEND_COOLDOWN_MS = 60 * 1000;
const TOKEN_REPLAY_GRACE_MS = 2 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const scrypt = promisify(scryptCallback);

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [salt, expectedHex] = encoded.split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function issueLoginToken(db: Pool, email: string) {
  const user = await db.query<{ id: string }>(
    `insert into app_users (email) values ($1)
     on conflict (email) do update set updated_at = now()
     returning id`,
    [email],
  );
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error("Local auth user creation returned no id");
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `insert into login_tokens (user_id, token_hash, expires_at)
     values ($1, $2, $3)`,
    [userId, hashToken(token), new Date(Date.now() + TOKEN_TTL_MS)],
  );
  return token;
}

export async function issueVerificationCode(db: Pool, email: string) {
  const user = await db.query<{ id: string }>(
    `insert into app_users (email) values ($1)
     on conflict (email) do update set updated_at = now()
     returning id`,
    [email],
  );
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error("Local auth user creation returned no id");
  const recent = await db.query<{ id: string }>(
    `select id from email_verification_codes
     where user_id = $1 and created_at > now() - ($2 * interval '1 millisecond')
     order by created_at desc limit 1`,
    [userId, CODE_RESEND_COOLDOWN_MS],
  );
  if (recent.rows.length > 0) return null;
  const code = randomInt(100000, 1000000).toString();
  await db.query(
    `insert into email_verification_codes (user_id, code_hash, expires_at)
     values ($1, $2, $3)`,
    [userId, hashToken(code), new Date(Date.now() + CODE_TTL_MS)],
  );
  return code;
}

export async function verifyVerificationCode(db: Pool, email: string, code: string) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const found = await client.query<{ id: string; user_id: string; email: string }>(
      `select c.id, c.user_id, u.email from email_verification_codes c
       join app_users u on u.id = c.user_id
       where u.email = $1 and c.code_hash = $2 and c.used_at is null and c.expires_at > now()
       order by c.created_at desc limit 1 for update`,
      [email, hashToken(code)],
    );
    const row = found.rows[0];
    if (!row) { await client.query("rollback"); return null; }
    await client.query("update email_verification_codes set used_at = now() where id = $1", [row.id]);
    const sessionToken = randomBytes(32).toString("base64url");
    await client.query(
      `insert into sessions (user_id, token_hash, expires_at)
       values ($1, $2, $3)`,
      [row.user_id, hashToken(sessionToken), new Date(Date.now() + SESSION_TTL_MS)],
    );
    await client.query("commit");
    return { token: sessionToken, userId: row.user_id, email: row.email };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

export async function exchangeLoginToken(db: Pool, token: string) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const found = await client.query<{ user_id: string; email: string }>(
      `select lt.user_id, u.email from login_tokens lt
       join app_users u on u.id = lt.user_id
       where lt.token_hash = $1 and lt.expires_at > now()
         and (lt.used_at is null or lt.used_at > now() - ($2 * interval '1 millisecond'))
       for update`,
      [hashToken(token), TOKEN_REPLAY_GRACE_MS],
    );
    const row = found.rows[0];
    if (!row) {
      await client.query("rollback");
      return null;
    }
    await client.query("update login_tokens set used_at = coalesce(used_at, now()) where token_hash = $1", [hashToken(token)]);
    const sessionToken = randomBytes(32).toString("base64url");
    await client.query(
      `insert into sessions (user_id, token_hash, expires_at)
       values ($1, $2, $3)`,
      [row.user_id, hashToken(sessionToken), new Date(Date.now() + SESSION_TTL_MS)],
    );
    await client.query("commit");
    return { token: sessionToken, userId: row.user_id, email: row.email };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export function createLocalRequestAuthenticator(db: Pool): RequestAuthenticator {
  return {
    async authenticate(request: Pick<FastifyRequest, "headers">) {
      const token = readSessionToken(request.headers.authorization, request.headers.cookie);
      if (!token) return null;
      const { rows } = await db.query<{ id: string; email: string }>(
        `select u.id, u.email from sessions s
         join app_users u on u.id = s.user_id
         where s.token_hash = $1 and s.expires_at > now()`,
        [hashToken(token)],
      );
      const row = rows[0];
      if (!row) return null;
      await db.query("update sessions set last_seen_at = now() where token_hash = $1", [hashToken(token)]);
      const user: AuthenticatedUser = {
        accessToken: token,
        email: row.email,
        id: row.id,
        userMetadata: {},
      };
      return user;
    },
  };
}

export async function getLocalSession(db: Pool, token: string) {
  const { rows } = await db.query<{ id: string; email: string }>(
    `select u.id, u.email from sessions s join app_users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function revokeLocalSession(db: Pool, token: string) {
  await db.query("delete from sessions where token_hash = $1", [hashToken(token)]);
}

function readSessionToken(authorization: string | string[] | undefined, cookie: string | undefined) {
  const cookieMatch = cookie?.match(/(?:^|;\s*)helstera_session=([^;]+)/);
  if (cookieMatch?.[1]) return cookieMatch[1];
  if (typeof authorization === "string") {
    const [scheme, token] = authorization.trim().split(/\s+/, 2);
    if (scheme?.toLowerCase() === "bearer" && token) return token;
  }
  return null;
}
