// Viewer endpoint: returns balance and plan info
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";

import {
  applicationErrorResponseSchemaLoose,
  profileUpdateRequestSchema,
  profileUpdateResponseSchema,
  unauthenticatedErrorResponseSchema,
  viewerResponseSchema,
  type SubscriptionPlan,
} from "@helstera/shared";

import {
  BootstrapError,
  type ViewerService,
} from "../features/bootstrap/ensure-user-foundation.js";
import type { CreditService } from "../features/credits/credit-service.js";
import type {
  RequestAuthenticator,
  DataClient,
} from "../auth/types.js";

export async function registerViewerRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    localDb: Pool;
    creditService?: CreditService;
    viewerService: ViewerService;
  },
) {
  app.get("/api/viewer", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);

      if (!user) {
        return reply.code(401).send(
          unauthenticatedErrorResponseSchema.parse({
            error: {
              code: "unauthorized",
              message: "Missing or invalid bearer token.",
            },
          }),
        );
      }

      const viewer = await options.viewerService.ensureViewer(user);

      // @credits-system: Attach credits info (top-up system)
      let credits: Record<string, unknown> | undefined;
      if (options.creditService) {
        try {
          const balance = await options.creditService.getBalance(
            viewer.workspace.id,
          );
          credits = {
            balance: balance.balance,
            totalToppedUp: balance.totalToppedUp,
            totalSpent: balance.totalSpent,
            plan: "free",
            dailyClaimed: false,
            limits: {
              maxConcurrentJobs: 3,
              maxResolution: "2160p",
              monthlyCredits: 0,
              dailyCredits: 0,
            },
          };
        } catch (err) {
          console.error("[viewer] Failed to fetch credits balance:", err);
        }
      }

      return reply
        .code(200)
        .send(viewerResponseSchema.parse({ ...viewer, credits }));
    } catch (error) {
      request.log.error({ err: error }, "viewer load failed");
      return sendApplicationError(
        error,
        reply,
        "bootstrap_failed",
        "Unable to prepare viewer workspace.",
      );
    }
  });

  app.patch("/api/viewer/profile", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);

      if (!user) {
        return reply.code(401).send(
          unauthenticatedErrorResponseSchema.parse({
            error: {
              code: "unauthorized",
              message: "Missing or invalid bearer token.",
            },
          }),
        );
      }

      const payload = profileUpdateRequestSchema.parse(request.body);
      const { rows } = await options.localDb.query(
        "update app_users set display_name = $1, updated_at = now() where id = $2 returning id, email, display_name, avatar_url",
        [payload.displayName, user.id],
      );
      const data = rows[0];
      if (!data) {
        return reply.code(500).send(
          applicationErrorResponseSchemaLoose.parse({
            error: {
              code: "profile_update_failed",
              message: "Unable to update profile.",
            },
          }),
        );
      }

      return reply.code(200).send(
        profileUpdateResponseSchema.parse({
          profile: {
            id: data.id,
            email: data.email ?? "",
            displayName: data.display_name ?? "",
            avatarUrl: data.avatar_url ?? null,
          },
        }),
      );
    } catch (error) {
      if (isZodError(error)) {
        return reply.code(400).send({
          issues: error.issues,
          message: "Invalid request body",
        });
      }

      return sendApplicationError(
        error,
        reply,
        "application_error",
        "Internal server error.",
      );
    }
  });
}

function isZodError(
  error: unknown,
): error is { issues: unknown[]; name: string } {
  return (
    error instanceof Error &&
    error.name === "ZodError" &&
    "issues" in error &&
    Array.isArray(error.issues)
  );
}

function sendApplicationError(
  error: unknown,
  reply: FastifyReply,
  fallbackCode: "application_error" | "bootstrap_failed",
  fallbackMessage: string,
) {
  if (error instanceof BootstrapError) {
    return reply.code(error.statusCode).send(
      applicationErrorResponseSchemaLoose.parse({
        error: {
          code: error.code,
          message: error.message,
        },
      }),
    );
  }

  return reply.code(500).send(
    applicationErrorResponseSchemaLoose.parse({
      error: {
        code: fallbackCode,
        message: fallbackMessage,
      },
    }),
  );
}
