// @payments-yeepay — YeePay Native/QR API routes: create topup, query status, webhook
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  applicationErrorResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@helstera/shared";
import { TOPUP_PACKAGES } from "@helstera/shared";

import type { YeePayService } from "../features/payments/yeepay-service.js";
import type { YeePayClient, YeePayWebhookPayload } from "../features/payments/yeepay-client.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { RequestAuthenticator } from "../supabase/user.js";

export async function registerYeePayRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    yeepayService: YeePayService;
    yeepayClient: YeePayClient;
    viewerService: ViewerService;
  },
) {
  // GET /api/yeepay/packages — list topup packages (CNY prices)
  app.get("/api/yeepay/packages", async (_request, reply) => {
    return reply.code(200).send({ packages: TOPUP_PACKAGES });
  });

  // POST /api/yeepay/topup — create a Native/QR scan topup order (preferred)
  app.post("/api/yeepay/topup", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const body = request.body as { packageId?: string };
      const packageId = body.packageId;

      if (!packageId) {
        return reply.code(400).send(
          applicationErrorResponseSchema.parse({
            error: {
              code: "invalid_request",
              message: "Invalid request. `packageId` is required.",
            },
          }),
        );
      }

      const viewer = await options.viewerService.ensureViewer(user);
      const result = await options.yeepayService.createTopupOrder({
        workspaceId: viewer.workspace.id,
        packageId,
      });

      return reply.code(200).send({
        outTradeNo: result.outTradeNo,
        qrCodeUrl: result.qrCodeUrl,
        qrCodeImage: result.qrCodeImage,
        expiredAt: result.expiredAt,
      });
    } catch (error) {
      return sendYeePayError(error, reply, "topup_failed");
    }
  });

  // GET /api/yeepay/orders/:outTradeNo — poll order status
  app.get<{ Params: { outTradeNo: string } }>(
    "/api/yeepay/orders/:outTradeNo",
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user) return sendUnauthenticated(reply);

        const { outTradeNo } = request.params;
        const status = await options.yeepayService.getOrderStatus(outTradeNo);

        return reply.code(200).send(status);
      } catch (error) {
        return sendYeePayError(error, reply, "order_query_failed");
      }
    },
  );
}

// ── Webhook handler (separate route, no auth) ──────────────

export async function registerYeePayWebhookRoute(
  app: FastifyInstance,
  options: {
    yeepayService: YeePayService;
    yeepayClient: YeePayClient;
  },
) {
  // Capture raw body for signature verification
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.post("/api/yeepay/webhook", async (request, reply) => {
    const rawBody = request.body as string;

    let payload: YeePayWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }

    if (!payload.outTradeNo || !payload.tradeNo) {
      return reply.code(400).send({ error: "Missing required fields" });
    }

    try {
      const result = await options.yeepayService.handleWebhook(payload);
      return reply.code(200).send({ received: true, ...result });
    } catch (error) {
      console.error("[YeePayWebhook] Processing error:", error);
      return reply.code(200).send({ received: true, error: "processing_failed" });
    }
  });
}

// ── Helpers ─────────────────────────────────────────────────

function sendUnauthenticated(reply: FastifyReply) {
  return reply.code(401).send(
    unauthenticatedErrorResponseSchema.parse({
      error: {
        code: "unauthorized",
        message: "Missing or invalid bearer token.",
      },
    }),
  );
}

function sendYeePayError(error: unknown, reply: FastifyReply, fallbackCode: string) {
  console.error("[YeePayRoutes] Unexpected error:", error);
  return reply.code(500).send(
    applicationErrorResponseSchema.parse({
      error: {
        code: fallbackCode,
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      },
    }),
  );
}
