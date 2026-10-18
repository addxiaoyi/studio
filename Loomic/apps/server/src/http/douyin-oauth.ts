import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { ServerEnv } from "../config/env.js";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";

type DouyinOAuthOptions = { auth: RequestAuthenticator; db: Pool; env: ServerEnv; viewerService: ViewerService };
const STATE_TTL_MS = 10 * 60 * 1000;

export function registerDouyinOAuthRoutes(app: FastifyInstance, options: DouyinOAuthOptions): void {
  app.get("/api/integrations/douyin/oauth/start", async (request: any, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "请先登录" } });
    const config = readOAuthConfig(options.env);
    if (!config) return reply.code(503).send({ ok: false, error: { code: "douyin_oauth_not_configured", message: "抖音 OAuth 配置未完成" } });
    const state = randomBytes(32).toString("base64url");
    await options.db.query("insert into social_oauth_states(state,user_id,platform,expires_at) values($1,$2,'douyin',$3)", [state, user.id, new Date(Date.now() + STATE_TTL_MS)]);
    const url = new URL(config.authUrl);
    url.searchParams.set("client_key", config.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.scopes);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("state", state);
    return reply.redirect(url.toString());
  });

  app.get("/api/integrations/douyin/oauth/exchange", async (request: any, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "登录状态已失效" } });
    const code = typeof request.query?.code === "string" ? request.query.code.trim() : "";
    const state = typeof request.query?.state === "string" ? request.query.state.trim() : "";
    if (!code || !state) return reply.code(400).send({ ok: false, error: { code: "invalid_oauth_callback", message: "抖音授权回调缺少 code 或 state" } });
    const config = readOAuthConfig(options.env);
    if (!config) return reply.code(503).send({ ok: false, error: { code: "douyin_oauth_not_configured", message: "抖音 OAuth 配置未完成" } });
    const stateResult = await options.db.query<{ user_id: string }>("delete from social_oauth_states where state=$1 and platform='douyin' and expires_at>now() returning user_id", [state]);
    if (stateResult.rows[0]?.user_id !== user.id) return reply.code(400).send({ ok: false, error: { code: "invalid_oauth_state", message: "授权状态无效或已过期" } });
    const tokenResponse = await fetch(config.tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_key: config.clientId, client_secret: config.clientSecret, code, grant_type: "authorization_code" }) });
    const payload = await tokenResponse.json() as { data?: { access_token?: string; open_id?: string }; message?: string };
    if (!tokenResponse.ok || !payload.data?.access_token || !payload.data.open_id) return reply.code(502).send({ ok: false, error: { code: "douyin_oauth_exchange_failed", message: payload.message ?? "抖音授权交换失败" } });
    const viewer = await options.viewerService.ensureViewer(user);
    const alias = `抖音账号 ${payload.data.open_id.slice(-6)}`;
    await options.db.query(`insert into publishing_accounts(workspace_id,platform,alias,notes,created_by,owner_user_id,connection_mode,external_account_id,status) values($1,'douyin',$2,'OAuth 已授权，发布仍需人工确认',$3,$3,'oauth_api',$4,'active') on conflict(workspace_id,platform,alias) do update set external_account_id=excluded.external_account_id,status='active',connection_mode='oauth_api',updated_at=now()`, [viewer.workspace.id, alias, user.id, payload.data.open_id]);
    return reply.redirect(`${options.env.webOrigin}/settings/?oauth=douyin_connected`);
  });
}

function readOAuthConfig(env: ServerEnv) {
  const clientId = process.env.DOUYIN_CLIENT_ID?.trim();
  const clientSecret = env.douyinClientSecret?.trim();
  const scopes = process.env.DOUYIN_OAUTH_SCOPES?.trim() || "user_info";
  const authUrl = process.env.DOUYIN_AUTH_URL?.trim();
  const tokenUrl = process.env.DOUYIN_TOKEN_URL?.trim();
  const redirectUri = process.env.DOUYIN_OAUTH_REDIRECT_URI?.trim() || `${env.webOrigin}/auth/callback`;
  if (!clientId || !clientSecret || !authUrl || !tokenUrl) return null;
  return { clientId, clientSecret, scopes, authUrl, tokenUrl, redirectUri };
}
