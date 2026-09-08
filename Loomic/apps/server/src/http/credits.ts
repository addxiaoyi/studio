// @credits-system — Credit API routes: balance, transactions, topup packages, topup order status
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import {
  TOPUP_PACKAGES,
  applicationErrorResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@helstera/shared";

import {
  CreditServiceError,
  type CreditService,
} from "../features/credits/credit-service.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { RequestAuthenticator } from "../supabase/user.js";
import type { PaymentService } from "../features/payments/payment-service.js";

const packageIdSchema = z.object({ packageId: z.string() });
const topupCheckoutSchema = z.object({ packageId: z.string() });

export async function registerCreditRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    creditService: CreditService;
    paymentService?: PaymentService;
    viewerService: ViewerService;
  },
) {
  // GET /api/credits — balance info
  app.get("/api/credits", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const viewer = await options.viewerService.ensureViewer(user);
      const balance = await options.creditService.getBalance(
        viewer.workspace.id,
      );

      return reply.code(200).send({
        balance: balance.balance,
        totalToppedUp: balance.totalToppedUp,
        totalSpent: balance.totalSpent,
      });
    } catch (error) {
      return sendCreditError(error, reply, "credit_query_failed");
    }
  });

  // GET /api/credits/packages — list top-up packages
  app.get("/api/credits/packages", async (_request, reply) => {
    return reply.code(200).send({ packages: TOPUP_PACKAGES });
  });

  // GET /api/credits/transactions — recent transactions
  app.get("/api/credits/transactions", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const viewer = await options.viewerService.ensureViewer(user);
      const query = request.query as { limit?: string };
      const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 20;

      const transactions = await options.creditService.getTransactions(
        viewer.workspace.id,
        limit,
      );

      return reply.code(200).send({ transactions });
    } catch (error) {
      return sendCreditError(error, reply, "credit_query_failed");
    }
  });

  // POST /api/credits/topup — create a top-up order
  app.post("/api/credits/topup", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const body = packageIdSchema.parse(request.body);
      const viewer = await options.viewerService.ensureViewer(user);

      const order = await options.creditService.createTopupOrder(
        viewer.workspace.id,
        body.packageId,
        "lemonsqueezy", // Will be overridden by provider route
      );

      return reply.code(200).send({ order });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply
          .code(400)
          .send({ issues: error.issues, message: "Invalid request body" });
      }
      return sendCreditError(error, reply, "topup_failed");
    }
  });

  // POST /api/credits/topup-checkout — create a Lemon Squeezy checkout for
  // international users (USD). Returns the redirect URL to open in browser.
  app.post("/api/credits/topup-checkout", async (request, reply) => {
    if (!options.paymentService) {
      return reply.code(503).send({
        error: {
          code: "payment_not_configured",
          message: "International payments are not configured. Use YeePay.",
        },
      });
    }
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const body = topupCheckoutSchema.parse(request.body);
      const viewer = await options.viewerService.ensureViewer(user);

      // Look up the package + variant
      const packages = options.creditService.listTopupPackages();
      const pkg = packages.find((p) => p.id === body.packageId);
      if (!pkg) {
        return reply.code(400).send({
          error: { code: "invalid_request", message: "Unknown package" },
        });
      }
      if (!pkg.lemonSqueezyVariantId) {
        return reply.code(400).send({
          error: {
            code: "variant_not_configured",
            message:
              "International checkout for this package is not yet available.",
          },
        });
      }

      // 1. Create the credit_topups order row
      const order = await options.creditService.createTopupOrder(
        viewer.workspace.id,
        body.packageId,
        "lemonsqueezy",
      );

      // 2. Create Lemon Squeezy checkout
      const redirectUrl = `${request.headers.origin ?? "http://localhost:3000"}/settings?tab=billing&topup=${encodeURIComponent(order.outTradeNo)}`;
      const { checkoutUrl } = await options.paymentService.createTopupCheckout(
        viewer.workspace.id,
        pkg.lemonSqueezyVariantId,
        redirectUrl,
      );

      return reply.code(200).send({ order, checkoutUrl });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          issues: error.issues,
          message: "Invalid request body",
        });
      }
      return sendCreditError(error, reply, "topup_failed");
    }
  });

  // GET /api/credits/topup/:outTradeNo — poll top-up order status
  app.get<{ Params: { outTradeNo: string } }>(
    "/api/credits/topup/:outTradeNo",
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user) return sendUnauthenticated(reply);

        const order = await options.creditService.getTopupOrder(
          request.params.outTradeNo,
        );
        if (!order) {
          return reply.code(404).send({ error: "Order not found" });
        }
        return reply.code(200).send({ order });
      } catch (error) {
        return sendCreditError(error, reply, "topup_failed");
      }
    },
  );
}

// ── Helpers ──────────────────────────────────────────────────

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

type CreditErrorFallbackCode =
  | "credit_query_failed"
  | "topup_failed"
  | "topup_activate_failed";

function sendCreditError(
  error: unknown,
  reply: FastifyReply,
  fallbackCode: CreditErrorFallbackCode,
) {
  if (error instanceof CreditServiceError) {
    return reply.code(error.statusCode).send(
      applicationErrorResponseSchema.parse({
        error: { code: error.code, message: error.message },
      }),
    );
  }
  const errorMessage =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error("[credits] unexpected error:", error);
  return reply.code(500).send(
    applicationErrorResponseSchema.parse({
      error: {
        code: fallbackCode,
        message: `An unexpected error occurred. ${errorMessage}`,
      },
    }),
  );
}
