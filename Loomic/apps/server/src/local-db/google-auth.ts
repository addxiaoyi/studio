import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { GoogleIdentity } from "../features/auth/google-identity.js";
import { hashToken } from "./auth.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export type GoogleLoginState = {
  nonce_hash: string;
  code_verifier: string;
  return_to: string;
  link_user_id: string | null;
};
export class GoogleAccountError extends Error {
  constructor(
    readonly code: "google_link_required" | "google_account_conflict",
  ) {
    super(code);
  }
}

export function createGoogleAuthStore(db: Pool) {
  return {
    async saveState(input: {
      state: string;
      browser: string;
      nonce: string;
      verifier: string;
      returnTo: string;
      linkUserId?: string;
    }) {
      await db.query(
        "delete from google_login_states where expires_at <= now()",
      );
      await db.query(
        `insert into google_login_states(state_hash,browser_hash,nonce_hash,code_verifier,return_to,link_user_id,expires_at)
        values($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')`,
        [
          hashToken(input.state),
          hashToken(input.browser),
          hashToken(input.nonce),
          input.verifier,
          input.returnTo,
          input.linkUserId ?? null,
        ],
      );
    },
    async consumeState(
      state: string,
      browser: string,
    ): Promise<GoogleLoginState | null> {
      const { rows } = await db.query<GoogleLoginState>(
        `delete from google_login_states
        where state_hash=$1 and browser_hash=$2 and expires_at>now()
        returning nonce_hash,code_verifier,return_to,link_user_id`,
        [hashToken(state), hashToken(browser)],
      );
      return rows[0] ?? null;
    },
    async connection(userId: string) {
      const { rows } = await db.query<{ email_at_link: string }>(
        "select email_at_link from google_identities where user_id=$1",
        [userId],
      );
      return rows[0]?.email_at_link ?? null;
    },
    async signIn(identity: GoogleIdentity, linkUserId?: string) {
      const client = await db.connect();
      try {
        await client.query("begin");
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1,0))",
          [`google-sub:${identity.subject}`],
        );
        const linked = (
          await client.query<{ user_id: string }>(
            "select user_id from google_identities where subject=$1",
            [identity.subject],
          )
        ).rows[0];
        if (linked && linkUserId && linked.user_id !== linkUserId)
          throw new GoogleAccountError("google_account_conflict");
        let userId = linked?.user_id;
        if (!userId) {
          if (!linkUserId && !identity.authoritativeEmail)
            throw new GoogleAccountError("google_link_required");
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1,0))",
            [`google-email:${identity.email}`],
          );
          if (linkUserId) {
            const user = (
              await client.query(
                "select id from app_users where id=$1 for update",
                [linkUserId],
              )
            ).rows[0];
            if (!user) throw new GoogleAccountError("google_account_conflict");
            userId = linkUserId;
          } else {
            const existing = (
              await client.query<{ id: string }>(
                "select id from app_users where email=$1 for update",
                [identity.email],
              )
            ).rows[0];
            if (existing) userId = existing.id;
            else {
              const created = (
                await client.query<{ id: string }>(
                  `insert into app_users(email,display_name) values($1,$2)
                on conflict(email) do nothing returning id`,
                  [identity.email, identity.name ?? null],
                )
              ).rows[0];
              if (!created)
                throw new GoogleAccountError("google_link_required");
              userId = created.id;
            }
          }
          const prior = (
            await client.query(
              "select subject from google_identities where user_id=$1",
              [userId],
            )
          ).rows[0];
          if (prior) throw new GoogleAccountError("google_account_conflict");
          await client.query(
            "insert into google_identities(subject,user_id,email_at_link) values($1,$2,$3)",
            [identity.subject, userId, identity.email],
          );
        }
        const token = randomBytes(32).toString("base64url");
        await client.query(
          "insert into sessions(user_id,token_hash,expires_at) values($1,$2,$3)",
          [userId, hashToken(token), new Date(Date.now() + SESSION_TTL_MS)],
        );
        await client.query("commit");
        return { token, userId };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
export type GoogleAuthStore = ReturnType<typeof createGoogleAuthStore>;
