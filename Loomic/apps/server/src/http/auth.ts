import type { FastifyInstance } from "fastify";
import nodemailer from "nodemailer";

import type { ServerEnv } from "../config/env.js";
import type { AdminSupabaseClient } from "../supabase/admin.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerAuthRoutes(
  app: FastifyInstance,
  options: { env: ServerEnv; getAdminClient: () => AdminSupabaseClient },
) {
  app.post<{ Body: { email?: string } }>("/api/auth/magic-link", async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    if (!email || !emailPattern.test(email)) {
      return reply.code(400).send({ error: { code: "invalid_email", message: "请输入有效的邮箱地址" } });
    }

    const { mailHost, mailUser, mailPassword, mailFrom } = options.env;
    if (!mailHost || !mailUser || !mailPassword || !mailFrom) {
      request.log.error("Magic-link email is not configured");
      return reply.code(503).send({ error: { code: "email_not_configured", message: "登录邮件服务暂不可用" } });
    }

    const { data, error } = await options.getAdminClient().auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${options.env.webOrigin}/auth/callback` },
    });
    if (error || !data.properties?.action_link) {
      request.log.error({ error }, "Supabase magic-link generation failed");
      return reply.code(400).send({ error: { code: "magic_link_failed", message: "该邮箱无法登录，请确认账号已注册" } });
    }

    const transporter = nodemailer.createTransport({
      host: mailHost,
      port: options.env.mailPort ?? 465,
      secure: (options.env.mailPort ?? 465) === 465,
      requireTLS: (options.env.mailPort ?? 465) === 587,
      auth: { user: mailUser, pass: mailPassword },
    });
    await transporter.sendMail({
      from: mailFrom,
      to: email,
      subject: "登录 Helstera",
      text: `点击以下链接登录 Helstera（15 分钟内有效）：\n\n${data.properties.action_link}`,
      html: `<p>点击以下链接登录 Helstera（15 分钟内有效）：</p><p><a href="${data.properties.action_link}">登录 Helstera</a></p>`,
    });
    return reply.send({ ok: true });
  });
}
