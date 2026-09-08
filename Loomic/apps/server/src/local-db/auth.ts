import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { FastifyRequest } from "fastify";
import type { AuthenticatedUser, RequestAuthenticator } from "../supabase/user.js";

const TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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

export async function exchangeLoginToken(db: Pool, token: string) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const found = await client.query<{ user_id: string; email: string }>(
      `select lt.user_id, u.email from login_tokens lt
       join app_users u on u.id = lt.user_id
       where lt.token_hash = $1 and lt.used_at is null and lt.expires_at > now()
       for update`,
      [hashToken(token)],
    );
    const row = found.rows[0];
    if (!row) {
      await client.query("rollback");
      return null;
    }
    await client.query("update login_tokens set used_at = now() where token_hash = $1", [hashToken(token)]);
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

function readSessionToken(authorization: string | string[] | undefined, cookie: string | undefined) {
  if (typeof authorization === "string") {
    const [scheme, token] = authorization.trim().split(/\s+/, 2);
    if (scheme?.toLowerCase() === "bearer" && token) return token;
  }
  const match = cookie?.match(/(?:^|;\s*)helstera_session=([^;]+)/);
  return match?.[1] ?? null;
}
