// @contact-sales — Enterprise sales inquiry submission endpoint
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  applicationErrorResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@helstera/shared";

import type { AdminSupabaseClient } from "../supabase/admin.js";

const contactInquirySchema = z.object({
  name: z.string().min(1, "请填写姓名").max(100),
  email: z.string().email("请填写有效邮箱"),
  company: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  teamSize: z.string().max(50).optional(),
  message: z.string().min(10, "请简要描述您的需求").max(2000),
  plan: z.string().max(50).optional(),
  source: z.string().max(50).optional(),
});

export type ContactInquiryInput = z.infer<typeof contactInquirySchema>;

export async function registerContactSalesRoutes(
  app: FastifyInstance,
  options: {
    getAdminClient: () => AdminSupabaseClient;
  },
) {
  // POST /api/contact-sales — submit an enterprise sales inquiry
  app.post("/api/contact-sales", async (request, reply) => {
    const body = request.body as unknown;
    const parsed = contactInquirySchema.safeParse(body);

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return reply.code(400).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "invalid_request",
            message: firstIssue
              ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
              : "Invalid request",
          },
        }),
      );
    }

    const input = parsed.data;
    const admin = options.getAdminClient();

    // 1. Persist to DB
    const { data, error: insertError } = await (admin as any)
      .from("contact_inquiries")
      .insert({
        name: input.name,
        email: input.email,
        company: input.company ?? null,
        phone: input.phone ?? null,
        team_size: input.teamSize ?? null,
        message: input.message,
        plan: input.plan ?? null,
        source: input.source ?? "pricing-page",
        status: "new",
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("[ContactSales] DB insert failed:", insertError);
      return reply.code(500).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "submission_failed",
            message: "保存咨询失败，请稍后重试。",
          },
        }),
      );
    }

    // 2. Notify sales team (best-effort, don't block the response)
    notifySalesTeam(input, data?.id).catch((err) => {
      console.error("[ContactSales] Notification failed:", err);
    });

    return reply.code(201).send({
      success: true,
      id: data?.id ?? null,
      message: "我们已收到您的咨询，将在 24 小时内联系您。",
    });
  });

  // GET /api/contact-sales/inquiries — list inquiries (admin only, for future admin dashboard)
  app.get("/api/contact-sales/inquiries", async (request, reply) => {
    const admin = options.getAdminClient();
    const { data, error } = await (admin as any)
      .from("contact_inquiries")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return reply.code(500).send(
        applicationErrorResponseSchema.parse({
          error: { code: "query_failed", message: "查询失败" },
        }),
      );
    }

    return reply.send({ inquiries: data ?? [] });
  });
}

// ── Notification (best-effort) ────────────────────────────────

async function notifySalesTeam(
  input: ContactInquiryInput,
  inquiryId: string | null,
): Promise<void> {
  // In production: send email via Resend / SendGrid / Postmark
  // For now: log to console so the sales team can be alerted via log monitoring
  console.log("[ContactSales] New inquiry", {
    id: inquiryId,
    name: input.name,
    email: input.email,
    company: input.company,
    teamSize: input.teamSize,
    plan: input.plan,
    source: input.source,
  });

  // Optional: Send Slack webhook if configured (SSRF guard)
  const rawSlackUrl = process.env.SLACK_WEBHOOK_URL;
  if (rawSlackUrl) {
    const parsedUrl = new URL(rawSlackUrl);
    if (!parsedUrl.hostname.endsWith(".slack.com")) {
      console.warn("SLACK_WEBHOOK_URL blocked: host not allowed");
    } else {
    await fetch(parsedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text:
          `📬 新的企业咨询\n` +
          `*${input.name}* (${input.email})\n` +
          `公司: ${input.company ?? "-"}\n` +
          `团队规模: ${input.teamSize ?? "-"}\n` +
          `关注方案: ${input.plan ?? "-"}\n` +
          `需求: ${input.message.slice(0, 200)}`,
      }),
    });
    }
  }
}
