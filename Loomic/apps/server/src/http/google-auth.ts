import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ServerEnv } from "../config/env.js";
import {
  type GoogleLoginClient,
  createGoogleLoginClient,
} from "../features/auth/google-identity.js";
import {
  GoogleAccountError,
  type GoogleAuthStore,
  createGoogleAuthStore,
} from "../local-db/google-auth.js";
import { sessionCookie } from "./local-auth.js";

const RANDOM_TOKEN = /^[A-Za-z0-9_-]{43}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Control characters and backslashes cannot be redirect targets.
const UNSAFE_REDIRECT_CHARS = /[\\\u0000-\u001f\u007f]/;
export function safeGoogleReturnTo(raw: unknown, origin: string): string {
  if (
    typeof raw !== "string" ||
    raw.length > 2048 ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    UNSAFE_REDIRECT_CHARS.test(raw)
  )
    return "/home/";
  const target = new URL(raw, origin);
  return target.origin === new URL(origin).origin
    ? target.pathname + target.search + target.hash
    : "/home/";
}

export function registerGoogleAuthRoutes(
  app: FastifyInstance,
  options: {
    db: Pool;
    auth: RequestAuthenticator;
    env: ServerEnv;
    client?: GoogleLoginClient;
    store?: GoogleAuthStore;
  },
) {
  const client = options.client ?? createGoogleLoginClient(options.env);
  const store = options.store ?? createGoogleAuthStore(options.db);
  const secure = options.env.webOrigin.startsWith("https://");
  const cookieName = secure ? "__Host-helstera_google" : "helstera_google";
  const flowCookie = (value: string, seconds: number) =>
    `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? "; Secure" : ""}`;
  const failure = (code: string) =>
    `/login/?${new URLSearchParams({ error: code })}`;
  const starts = new Map<string, { count: number; until: number }>();
  function allowStart(ip: string) {
    const now = Date.now();
    if (starts.size >= 1_000)
      for (const [address, window] of starts)
        if (window.until <= now) starts.delete(address);
    const window = starts.get(ip);
    if (!window || window.until <= now) {
      if (starts.size >= 10_000) return false;
      starts.set(ip, { count: 1, until: now + 60_000 });
      return true;
    }
    return ++window.count <= 200;
  }

  app.get("/api/local-auth/providers", async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const user = await options.auth.authenticate(request);
    return {
      google: {
        enabled: Boolean(client),
        linkedEmail: user ? await store.connection(user.id) : null,
      },
    };
  });
  app.get(
    "/api/local-auth/google/start",
    { logLevel: "silent" },
    async (request, reply) => {
      reply
        .header("cache-control", "no-store")
        .header("referrer-policy", "no-referrer");
      if (!client) return reply.redirect(failure("google_unavailable"));
      if (!allowStart(request.ip))
        return reply
          .header("retry-after", "60")
          .code(429)
          .send({
            ok: false,
            error: {
              code: "rate_limited",
              message: "登录请求过于频繁，请稍后重试。",
            },
          });
      const query = request.query as { returnTo?: unknown; intent?: unknown };
      const user =
        query.intent === "link"
          ? await options.auth.authenticate(request)
          : null;
      if (query.intent === "link" && !user)
        return reply.redirect(failure("google_link_signin_required"));
      const state = randomBytes(32).toString("base64url");
      const browser = randomBytes(32).toString("base64url");
      const nonce = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      try {
        await store.saveState({
          state,
          browser,
          nonce,
          verifier,
          returnTo:
            query.intent === "link"
              ? "/settings/?tab=profile&google=linked"
              : safeGoogleReturnTo(query.returnTo, options.env.webOrigin),
          ...(user ? { linkUserId: user.id } : {}),
        });
        reply.header("set-cookie", flowCookie(browser, 600));
        return reply.redirect(
          client.authorizationUrl({
            state,
            nonce,
            challenge: createHash("sha256")
              .update(verifier)
              .digest("base64url"),
          }),
        );
      } catch {
        app.log.error({ event: "google_signin_start_failed" });
        return reply.redirect(failure("google_unavailable"));
      }
    },
  );
  app.get(
    "/api/local-auth/google/callback",
    { logLevel: "silent" },
    async (request, reply) => {
      reply
        .header("cache-control", "no-store")
        .header("referrer-policy", "no-referrer");
      if (!client) return reply.redirect(failure("google_unavailable"));
      const query = request.query as {
        state?: unknown;
        code?: unknown;
        error?: unknown;
      };
      const browser = request.headers.cookie
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1);
      if (
        typeof query.state !== "string" ||
        !RANDOM_TOKEN.test(query.state) ||
        !browser ||
        !RANDOM_TOKEN.test(browser)
      )
        return reply.redirect(failure("google_state_invalid"));
      let linking = false;
      const callbackFailure = (code: string) =>
        linking
          ? `/settings/?${new URLSearchParams({ tab: "profile", google: code })}`
          : failure(code);
      try {
        const state = await store.consumeState(query.state, browser);
        if (!state) return reply.redirect(failure("google_state_invalid"));
        linking = Boolean(state.link_user_id);
        reply.header("set-cookie", flowCookie("", 0));
        if (query.error !== undefined)
          return reply.redirect(
            callbackFailure(
              query.error === "access_denied"
                ? "google_canceled"
                : "google_failed",
            ),
          );
        if (
          typeof query.code !== "string" ||
          !query.code ||
          query.code.length > 4096
        )
          return reply.redirect(callbackFailure("google_failed"));
        if (state.link_user_id) {
          const current = await options.auth.authenticate(request);
          if (current?.id !== state.link_user_id)
            return reply.redirect(failure("google_link_signin_required"));
        }
        const identity = await client.exchange(
          query.code,
          state.code_verifier,
          state.nonce_hash,
        );
        const session = await store.signIn(
          identity,
          state.link_user_id ?? undefined,
        );
        reply.header("set-cookie", [
          flowCookie("", 0),
          sessionCookie(session.token, options.env.webOrigin),
        ]);
        return reply.redirect(state.return_to);
      } catch (error) {
        const reason =
          error instanceof GoogleAccountError ? error.code : "google_failed";
        // OAuth library errors may embed the code, client secret or token request.
        app.log.warn({ event: "google_signin_callback_failed", reason });
        return reply.redirect(callbackFailure(reason));
      }
    },
  );
}
