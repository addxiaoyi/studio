import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { issueLoginToken, exchangeLoginToken } from "../local-db/auth.js";
import type { ServerEnv } from "../config/env.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOKIE = "helstera_session";

export function registerLocalAuthRoutes(app: FastifyInstance, options: { db: Pool; env: ServerEnv }) {
  app.post<{ Body: { email?: string } }>("/api/local-auth/magic-link", async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    if (!email || !emailPattern.test(email)) {
      return reply.code(400).send({ error: { code: "invalid_email", message: "请输入有效的邮箱地址" } });
    }
    const token = await issueLoginToken(options.db, email);
    const link = `${options.env.webOrigin}/auth/callback?local_token=${encodeURIComponent(token)}`;
    request.log.info({ email }, "local auth link issued");
    return reply.send({ ok: true, link });
  });

  app.post<{ Body: { token?: string } }>("/api/local-auth/exchange", async (request, reply) => {
    const token = request.body?.token?.trim();
    if (!token) return reply.code(400).send({ error: { code: "missing_token", message: "登录链接无效" } });
    const session = await exchangeLoginToken(options.db, token);
    if (!session) return reply.code(401).send({ error: { code: "invalid_token", message: "登录链接已过期或已使用" } });
    reply.header("set-cookie", `${COOKIE}=${session.token}; Max-Age=${30 * 24 * 60 * 60}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    return reply.send({ ok: true, user: { id: session.userId, email: session.email } });
  });
}
