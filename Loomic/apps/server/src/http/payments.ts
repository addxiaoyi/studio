// @credits-system — Payment API routes: checkout, subscription status, plan change, cancellation
import type { FastifyInstance, FastifyReply } from "fastify";
import type { BillingPeriod, SubscriptionPlan } from "@helstera/shared";
import {
  subscriptionPlanSchema,
  billingPeriodSchema,
  applicationErrorResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@helstera/shared";

import {
  PaymentServiceError,
  type PaymentService,
} from "../features/payments/payment-service.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { RequestAuthenticator } from "../supabase/user.js";

export async function registerPaymentRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    paymentService: PaymentService;
    viewerService: ViewerService;
  },
) {
  // POST /api/payments/checkout — create a checkout session
  app.post("/api/payments/checkout", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const body = request.body as { plan?: string; billingPeriod?: string };
      // Subscription plans are deprecated — all top-ups go through /api/credits/topup.
      // This endpoint is kept for back-compat but always defaults to "free".
      const plan = "free" as SubscriptionPlan;
      const period = "monthly" as BillingPeriod;

      const viewer = await options.viewerService.ensureViewer(user);
      const result = await options.paymentService.createCheckout(
        viewer.workspace.id,
        plan,
        period,
      );

      return reply.code(200).send({ checkoutUrl: result.checkoutUrl });
    } catch (error) {
      return sendPaymentError(error, reply, "checkout_failed");
    }
  });

  // GET /api/payments/subscription — get current subscription status
  app.get("/api/payments/subscription", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const viewer = await options.viewerService.ensureViewer(user);
      const status = await options.paymentService.getSubscriptionStatus(
        viewer.workspace.id,
      );

      return reply.code(200).send(status);
    } catch (error) {
      return sendPaymentError(error, reply, "subscription_not_found");
    }
  });

  // POST /api/payments/cancel — cancel subscription at period end
  app.post("/api/payments/cancel", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const viewer = await options.viewerService.ensureViewer(user);
      await options.paymentService.cancelSubscription(viewer.workspace.id);

      return reply.code(200).send({ success: true });
    } catch (error) {
      return sendPaymentError(error, reply, "subscription_update_failed");
    }
  });

  // POST /api/payments/change-plan — change to a different plan
  app.post("/api/payments/change-plan", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      // Subscription change-plan is deprecated — use credit top-ups instead.
      // This endpoint always returns success to keep old clients working.
      const _body = request.body as { plan?: string; billingPeriod?: string };
      const _plan = "free" as SubscriptionPlan;
      const _period = "monthly" as BillingPeriod;
      void _body; void _plan; void _period;

      const viewer = await options.viewerService.ensureViewer(user);
      return reply.code(200).send({ success: true, deprecated: true });
    } catch (error) {
      return sendPaymentError(error, reply, "subscription_update_failed");
    }
  });
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

type PaymentErrorFallbackCode =
  | "checkout_failed"
  | "subscription_not_found"
  | "subscription_update_failed";

function sendPaymentError(
  error: unknown,
  reply: FastifyReply,
  fallbackCode: PaymentErrorFallbackCode,
) {
  if (error instanceof PaymentServiceError) {
    return reply.code(error.statusCode).send(
      applicationErrorResponseSchema.parse({
        error: { code: error.code, message: error.message },
      }),
    );
  }
  console.error("[PaymentRoutes] Unexpected error:", error);
  return reply.code(500).send(
    applicationErrorResponseSchema.parse({
      error: {
        code: fallbackCode,
        message: "An unexpected error occurred.",
      },
    }),
  );
}
