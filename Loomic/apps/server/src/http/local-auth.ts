import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import nodemailer from "nodemailer";
import { issueLoginToken, exchangeLoginToken, getLocalSession, revokeLocalSession, verifyPassword, hashToken } from "../local-db/auth.js";
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
    const { mailHost, mailUser, mailPassword, mailFrom } = options.env;
    if (!mailHost || !mailUser || !mailPassword || !mailFrom) {
      return reply.code(503).send({ error: { code: "email_not_configured", message: "登录邮件服务暂不可用" } });
    }
    const transporter = nodemailer.createTransport({
      host: mailHost,
      port: options.env.mailPort ?? 587,
      secure: false,
      requireTLS: true,
      auth: { user: mailUser, pass: mailPassword },
    });
    await transporter.sendMail({
      from: mailFrom,
      to: email,
      subject: "登录 Helstera",
      text: `点击以下链接登录 Helstera（15 分钟内有效）：\n\n${link}`,
      html: `<p>点击以下链接登录 Helstera（15 分钟内有效）：</p><p><a href="${link}">登录 Helstera</a></p>`,
    });
    request.log.info({ email }, "local auth link issued");
    return reply.send({ ok: true });
  });

  app.post<{ Body: { email?: string; password?: string } }>("/api/local-auth/password", async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    const password = request.body?.password;
    if (!email || !password || !emailPattern.test(email)) return reply.code(400).send({ error: { code: "invalid_credentials", message: "邮箱或密码不正确" } });
    const { rows } = await options.db.query("select id, email, password_hash from app_users where email = $1", [email]);
    const user = rows[0];
    if (!user?.password_hash || !(await verifyPassword(password, user.password_hash))) return reply.code(401).send({ error: { code: "invalid_credentials", message: "邮箱或密码不正确" } });
    const sessionToken = randomBytes(32).toString("base64url");
    await options.db.query("insert into sessions (user_id, token_hash, expires_at) values ($1, $2, $3)", [user.id, hashToken(sessionToken), new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)]);
    reply.header("set-cookie", `${COOKIE}=${sessionToken}; Max-Age=${30 * 24 * 60 * 60}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    return reply.send({ ok: true, access_token: "local-session", user: { id: user.id, email: user.email } });
  });

  app.post<{ Body: { token?: string } }>("/api/local-auth/exchange", async (request, reply) => {
    const token = request.body?.token?.trim();
    if (!token) return reply.code(400).send({ error: { code: "missing_token", message: "登录链接无效" } });
    const session = await exchangeLoginToken(options.db, token);
    if (!session) return reply.code(401).send({ error: { code: "invalid_token", message: "登录链接已过期或已使用" } });
    reply.header("set-cookie", `${COOKIE}=${session.token}; Max-Age=${30 * 24 * 60 * 60}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    return reply.send({ ok: true, access_token: "local-session", user: { id: session.userId, email: session.email } });
  });

  app.get("/api/local-auth/session", async (request, reply) => {
    const cookie = request.headers.cookie?.match(/(?:^|;\s*)helstera_session=([^;]+)/)?.[1];
    const user = cookie ? await getLocalSession(options.db, cookie) : null;
    return reply.send({ session: user ? { access_token: "local-session", user } : null });
  });

  app.post("/api/local-auth/sign-out", async (request, reply) => {
    const token = request.headers.cookie?.match(/(?:^|;\s*)helstera_session=([^;]+)/)?.[1];
    if (token) await revokeLocalSession(options.db, token);
    reply.header("set-cookie", `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
    return reply.code(204).send();
  });
}
