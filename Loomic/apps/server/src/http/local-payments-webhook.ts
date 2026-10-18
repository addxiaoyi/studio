// @credits-system — Payment webhook handler (local mode): epay, yeepay, etc.
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import type {
  PaymentService,
  WebhookPayload,
} from "../features/payments/payment-service.js";

export async function registerLocalPaymentWebhookRoute(
  app: FastifyInstance,
  options: {
    db: Pool;
    paymentService: PaymentService;
    webhookSecret: string;
  },
) {
  // Register a custom content-type parser to capture the raw body for
  // HMAC signature verification while still parsing JSON.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.post("/api/payments/webhook", async (request, reply) => {
    const rawBody = request.body as string;

    // ── 1. Verify webhook signature ──────────────────────────
    const signature = request.headers["x-signature"] as string | undefined;
    if (!signature) {
      return reply.code(401).send({ error: "Missing X-Signature header" });
    }

    const expected = crypto
      .createHmac("sha256", options.webhookSecret)
      .update(rawBody)
      .digest("hex");

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return reply.code(401).send({ error: "Invalid webhook signature" });
    }

    // ── 2. Parse body ────────────────────────────────────────
    let payload: WebhookPayload;
    try {
      payload = JSON.parse(rawBody) as WebhookPayload;
    } catch {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }

    const eventName = payload.meta?.event_name;
    if (!eventName) {
      return reply.code(400).send({ error: "Missing meta.event_name" });
    }

    const workspaceId = payload.meta?.custom_data?.workspace_id ?? null;
    const eventId = payload.data?.id ?? null;

    // ── 3. Log to payment_events audit table ─────────────────
    try {
      await options.db.query(
        `insert into payment_events (event_name, provider_event_id, workspace_id, payload, processed)
         values ($1, $2, $3, $4, false)`,
        [eventName, eventId, workspaceId, JSON.stringify(payload)],
      );
    } catch (insertError) {
      console.error("[Webhook] Failed to log payment event:", insertError);
      // Continue processing even if audit logging fails
    }

    // ── 4. Process event ─────────────────────────────────────
    try {
      await options.paymentService.handleWebhookEvent(eventName, payload);

      // Mark as processed
      if (eventId) {
        await options.db.query(
          `update payment_events set processed = true where provider_event_id = $1`,
          [eventId],
        );
      }
    } catch (processingError) {
      const errorMessage =
        processingError instanceof Error
          ? processingError.message
          : "Unknown error";

      console.error(`[Webhook] Error processing ${eventName}:`, errorMessage);

      // Record error in audit trail
      if (eventId) {
        await options.db.query(
          `update payment_events set error_message = $1 where provider_event_id = $2`,
          [errorMessage, eventId],
        );
      }

      // Still return 200 to prevent payment provider from retrying endlessly.
      // The error is logged for manual investigation.
    }

    return reply.code(200).send({ received: true });
  });
}
