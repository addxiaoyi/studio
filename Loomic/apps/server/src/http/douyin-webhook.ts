import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { ServerEnv } from "../config/env.js";

export function registerDouyinWebhookRoutes(app: FastifyInstance, options: { db: Pool; env: ServerEnv }): void {
  app.post("/api/integrations/douyin/webhook", async (request, reply) => {
    const rawBody = typeof (request as any).rawBody === "string" ? (request as any).rawBody as string : JSON.stringify(request.body ?? {});
    const body = request.body as { event?: string; client_key?: string; content?: { challenge?: number | string } };

    // Douyin uses this unsigned, side-effect-free handshake before subscriptions can be enabled.
    if (body.event === "verify_webhook" && body.content?.challenge !== undefined) {
      return reply.type("application/json").send({ challenge: body.content.challenge });
    }

    const secret = options.env.douyinClientSecret;
    if (!secret) return reply.code(503).send({ ok: false, error: { code: "douyin_webhook_not_configured", message: "Douyin webhook secret is not configured" } });
    const signature = String(request.headers["x-douyin-signature"] ?? "").trim().toLowerCase();
    const expected = createHash("sha1").update(secret).update(rawBody).digest("hex");
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return reply.code(401).send({ ok: false, error: { code: "invalid_douyin_signature", message: "Invalid Douyin webhook signature" } });
    }
    if (options.env.douyinClientKey && body.client_key && body.client_key !== options.env.douyinClientKey) {
      return reply.code(403).send({ ok: false, error: { code: "douyin_client_key_mismatch", message: "Douyin client key does not match" } });
    }
    const msgId = String(request.headers["msg-id"] ?? randomUUID());
    const eventName = typeof body.event === "string" && body.event ? body.event : "unknown";
    const inserted = await options.db.query(
      `insert into douyin_webhook_events(msg_id,client_key,event_name,payload)
       values($1,$2,$3,$4::jsonb) on conflict(msg_id) do nothing returning id`,
      [msgId, body.client_key ?? null, eventName, rawBody],
    );
    return { ok: true, accepted: true, duplicate: inserted.rowCount === 0, msgId, event: eventName };
  });
}
