import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import nodemailer from "nodemailer";
import { issueLoginToken, exchangeLoginToken, getLocalSession, revokeLocalSession, verifyPassword, hashToken, issueVerificationCode, verifyVerificationCode, hashPassword } from "../local-db/auth.js";
import type { ServerEnv } from "../config/env.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOKIE = "helstera_session";
const DESKTOP_LOGIN_TOKEN_TTL_MS = 3 * 60 * 1000;
const DESKTOP_LOGIN_STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function sessionCookie(value: string, webOrigin: string) {
  const secure = webOrigin.startsWith("https://") ? "; Secure" : "";
  return `${COOKIE}=${value}; Max-Age=${30 * 24 * 60 * 60}; Path=/; HttpOnly${secure}; SameSite=Lax`;
}

export function registerLocalAuthRoutes(app: FastifyInstance, options: { db: Pool; env: ServerEnv }) {
  app.post<{ Body: { email?: string; password?: string } }>("/api/local-auth/register", async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    const password = request.body?.password ?? "";
    if (!email || !emailPattern.test(email) || password.length < 8) return reply.code(400).send({ error: { code: "invalid_registration", message: "请输入有效邮箱和至少 8 位密码" } });
    const passwordHash = await hashPassword(password);
    const { rows } = await options.db.query("insert into app_users (email, password_hash) values ($1, $2) on conflict (email) do update set password_hash=excluded.password_hash, updated_at=now() returning id,email", [email, passwordHash]);
    const sessionToken = randomBytes(32).toString("base64url");
    await options.db.query("insert into sessions (user_id, token_hash, expires_at) values ($1,$2,$3)", [rows[0].id, hashToken(sessionToken), new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)]);
    reply.header("set-cookie", sessionCookie(sessionToken, options.env.webOrigin));
    return reply.send({ ok: true, access_token: "local-session", user: rows[0] });
  });
  // Legacy clients may still call the old path while their static bundle is cached.
  app.post("/api/auth/magic-link", async (request, reply) => {
    const email = (request.body as { email?: string } | undefined)?.email?.trim().toLowerCase();
    if (!email || !emailPattern.test(email)) return reply.code(400).send({ error: { code: "invalid_email", message: "请输入有效的邮箱地址" } });
    return reply.redirect("/api/local-auth/send-code", 307);
  });
  app.post<{ Body: { email?: string } }>("/api/local-auth/send-code", async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    if (!email || !emailPattern.test(email)) return reply.code(400).send({ error: { code: "invalid_email", message: "请输入有效的邮箱地址" } });
    const { mailHost, mailUser, mailPassword, mailFrom } = options.env;
    if (!mailHost || !mailUser || !mailPassword || !mailFrom) return reply.code(503).send({ error: { code: "email_not_configured", message: "验证码服务暂不可用" } });
    const code = await issueVerificationCode(options.db, email);
    if (!code) return reply.send({ ok: true, alreadySent: true });
    const message = {
      from: mailFrom,
      to: email,
      subject: "Helstera 登录验证码",
      text: `您好，您的 Helstera 登录验证码是：${code}\n\n验证码 10 分钟内有效，仅可使用一次。如果这不是您的操作，请忽略此邮件。\n\nHelstera 团队`,
      html: `<!doctype html><html lang="zh-CN"><body style="margin:0;background:#f5f5f3;color:#171717;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif"><div style="max-width:560px;margin:32px auto;padding:0 20px"><div style="background:#171717;color:#fff;padding:22px 28px;border-radius:14px 14px 0 0;font-size:20px;font-weight:600">Helstera</div><div style="background:#fff;padding:32px 28px;border:1px solid #e5e5e3;border-top:0;border-radius:0 0 14px 14px"><p style="margin:0 0 18px;font-size:16px">您好，</p><p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#444">您的登录验证码是：</p><p style="margin:0 0 24px;font-size:34px;line-height:1;font-weight:700;letter-spacing:8px;color:#171717">${code}</p><p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#777">验证码 10 分钟内有效，仅可使用一次。</p><p style="margin:0;font-size:13px;line-height:1.6;color:#777">如果这不是您的操作，请忽略此邮件。</p></div><p style="margin:18px 0;text-align:center;font-size:12px;color:#999">Helstera 团队</p></div></body></html>`,
    };
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const transporter = nodemailer.createTransport({ host: mailHost, port: options.env.mailPort ?? 587, secure: false, requireTLS: true, auth: { user: mailUser, pass: mailPassword } });
      try {
        await transporter.sendMail(message);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        transporter.close();
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    if (lastError) {
      await options.db.query("delete from email_verification_codes where code_hash = $1 and used_at is null", [hashToken(code)]);
      throw lastError;
    }
    request.log.info({ email }, "local auth code issued");
    return reply.send({ ok: true });
  });

  app.post<{ Body: { email?: string; code?: string } }>("/api/local-auth/verify-code", async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    const code = request.body?.code?.trim();
    if (!email || !emailPattern.test(email) || !code || !/^\d{6}$/.test(code)) return reply.code(400).send({ error: { code: "invalid_code", message: "请输入 6 位验证码" } });
    const session = await verifyVerificationCode(options.db, email, code);
    if (!session) return reply.code(401).send({ error: { code: "invalid_code", message: "验证码错误或已过期" } });
    reply.header("set-cookie", sessionCookie(session.token, options.env.webOrigin));
    return reply.send({ ok: true, access_token: "local-session", user: { id: session.userId, email: session.email } });
  });

  app.post<{ Body: { email?: string } }>("/api/local-auth/magic-link", async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    if (!email || !emailPattern.test(email)) {
      return reply.code(400).send({ error: { code: "invalid_email", message: "请输入有效的邮箱地址" } });
    }
    const token = await issueLoginToken(options.db, email);
    const link = `${options.env.webOrigin}/auth/callback?local_token=${encodeURIComponent(token)}&v=${Date.now()}`;
    const { mailHost, mailUser, mailPassword, mailFrom } = options.env;
    if (!mailHost || !mailUser || !mailPassword || !mailFrom) {
      return reply.code(503).send({ error: { code: "email_not_configured", message: "登录邮件服务暂不可用" } });
    }
    const message = {
      from: mailFrom,
      to: email,
      subject: "登录 Helstera 工作台",
      text: `您好，\n\n有人请求登录 Helstera 工作台。请打开以下链接完成登录：\n\n${link}\n\n此链接 15 分钟内有效且只能使用一次。若这不是您的操作，请忽略此邮件。\n\nHelstera 团队`,
      html: `<!doctype html><html lang="zh-CN"><body style="margin:0;background:#f5f5f3;color:#171717;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif"><div style="max-width:560px;margin:32px auto;padding:0 20px"><div style="background:#171717;color:#fff;padding:22px 28px;border-radius:14px 14px 0 0;font-size:20px;font-weight:600;letter-spacing:.2px">Helstera</div><div style="background:#fff;padding:32px 28px;border:1px solid #e5e5e3;border-top:0;border-radius:0 0 14px 14px"><p style="margin:0 0 18px;font-size:16px">您好，</p><p style="margin:0 0 26px;font-size:15px;line-height:1.7;color:#444">有人请求登录您的 Helstera 工作台。点击下方按钮即可继续：</p><p style="margin:0 0 28px"><a href="${link}" style="display:inline-block;padding:13px 22px;background:#171717;color:#fff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600">立即登录工作台</a></p><p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#777">此链接 15 分钟内有效且只能使用一次。</p><p style="margin:0;font-size:13px;line-height:1.6;color:#777">如果这不是您的操作，请忽略此邮件。</p><hr style="margin:28px 0;border:0;border-top:1px solid #eee"><p style="margin:0;font-size:12px;line-height:1.6;color:#999">如果按钮无法使用，请将以下地址复制到浏览器：<br><span style="word-break:break-all">${link}</span></p></div><p style="margin:18px 0;text-align:center;font-size:12px;color:#999">Helstera 团队</p></div></body></html>`,
    };
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const transporter = nodemailer.createTransport({ host: mailHost, port: options.env.mailPort ?? 587, secure: false, requireTLS: true, auth: { user: mailUser, pass: mailPassword } });
      try { await transporter.sendMail(message); lastError = undefined; break; } catch (error) { lastError = error; await transporter.close(); if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1))); }
    }
    if (lastError) throw lastError;
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
    reply.header("set-cookie", sessionCookie(sessionToken, options.env.webOrigin));
    return reply.send({ ok: true, access_token: "local-session", user: { id: user.id, email: user.email } });
  });

  app.post<{ Body: { email?: string; code?: string; password?: string } }>("/api/local-auth/reset-password", async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    const code = request.body?.code?.trim();
    const password = request.body?.password ?? "";
    if (!email || !emailPattern.test(email) || !code || !/^\d{6}$/.test(code) || password.length < 8) return reply.code(400).send({ error: { code: "invalid_reset", message: "请输入邮箱、6 位验证码和至少 8 位新密码" } });
    const session = await verifyVerificationCode(options.db, email, code);
    if (!session) return reply.code(401).send({ error: { code: "invalid_code", message: "验证码错误或已过期" } });
    await options.db.query("update app_users set password_hash = $1, updated_at = now() where id = $2", [await hashPassword(password), session.userId]);
    reply.header("set-cookie", sessionCookie(session.token, options.env.webOrigin));
    return reply.send({ ok: true, access_token: "local-session", user: { id: session.userId, email: session.email } });
  });

  app.post<{ Body: { token?: string } }>("/api/local-auth/exchange", async (request, reply) => {
    const token = request.body?.token?.trim();
    if (!token) return reply.code(400).send({ error: { code: "missing_token", message: "登录链接无效" } });
    const session = await exchangeLoginToken(options.db, token);
    if (!session) return reply.code(401).send({ error: { code: "invalid_token", message: "登录链接已过期或已使用" } });
    reply.header("set-cookie", sessionCookie(session.token, options.env.webOrigin));
    return reply.send({ ok: true, access_token: "local-session", user: { id: session.userId, email: session.email } });
  });

  app.post<{ Body: { state?: string } }>("/api/local-auth/desktop-confirm", async (request, reply) => {
    const state = request.body?.state?.trim();
    if (!state || !DESKTOP_LOGIN_STATE_PATTERN.test(state)) {
      return reply.code(400).send({ error: { code: "invalid_desktop_login", message: "桌面登录请求无效，请返回桌面重新发起。" } });
    }
    const sessionToken = request.headers.cookie?.match(/(?:^|;\s*)helstera_session=([^;]+)/)?.[1];
    const user = sessionToken ? await getLocalSession(options.db, sessionToken) : null;
    if (!user) return reply.code(401).send({ error: { code: "unauthorized", message: "请先登录网页账户，再确认桌面登录。" } });

    const token = await issueLoginToken(options.db, user.email, DESKTOP_LOGIN_TOKEN_TTL_MS);
    const callbackUrl = new URL("helstera://auth/callback");
    callbackUrl.searchParams.set("desktop_token", token);
    callbackUrl.searchParams.set("state", state);
    return reply.send({ callbackUrl: callbackUrl.toString() });
  });

  app.post<{ Body: { token?: string } }>("/api/local-auth/desktop-exchange", async (request, reply) => {
    const token = request.body?.token?.trim();
    if (!token) return reply.code(400).send({ error: { code: "missing_token", message: "桌面登录授权码无效。" } });
    const session = await exchangeLoginToken(options.db, token, { allowReplayGrace: false });
    if (!session) return reply.code(401).send({ error: { code: "invalid_token", message: "桌面登录授权已过期或已使用，请重新发起。" } });
    reply.header("set-cookie", sessionCookie(session.token, options.env.webOrigin));
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
    reply.header("set-cookie", sessionCookie("", options.env.webOrigin).replace(`Max-Age=${30 * 24 * 60 * 60}`, "Max-Age=0"));
    return reply.code(204).send();
  });
}
