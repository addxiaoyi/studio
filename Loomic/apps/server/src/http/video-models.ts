import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { calculateConfiguredVideoPricePerSecond, CONFIGURED_PRICE_MULTIPLIER, getConfiguredBilling, getVideoCreditCost } from "@helstera/shared";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { CreditService } from "../features/credits/credit-service.js";
import { getAvailableVideoModels } from "../generation/providers/registry.js";
import { listModelAvailability, listHealthyModels, minimumCreditCost, type AvailableProviderModel, type ModelAvailability } from "./model-availability.js";
import type { RequestAuthenticator } from "../auth/types.js";
import { getPublicModelPresentation } from "./public-model-catalog.js";
import { isRemovedModelId } from "../generation/removed-models.js";

export async function registerVideoModelRoutes(app: FastifyInstance, options: {
  auth: RequestAuthenticator; creditService: CreditService; viewerService: ViewerService; localDb?: Pool;
}) {
  app.get("/api/video-models", async (request, reply) => {
    let authenticated = false;
    let balance = 0;
    try {
      const user = await options.auth.authenticate(request);
      if (user) {
        const viewer = await options.viewerService.ensureViewer(user);
        balance = (await options.creditService.getBalance(viewer.workspace.id)).balance;
        authenticated = true;
      }
    } catch {
      authenticated = false;
    }

    if (options.localDb) {
      const rows = (await listModelAvailability(options.localDb, "video")).filter(isSellableVideoModel);
      const toPublicModel = (row: ModelAvailability, available: boolean) => {
        const presentation = getPublicModelPresentation(row.model_id, row.display_name, "video");
        if (!presentation) return null;
        return {
          id: row.model_id,
          displayName: presentation.displayName,
          description: presentation.description,
          provider: "configured",
          availability: !available ? "unavailable" : row.health_status === "unknown" ? "unverified" : "available",
          availabilityReason: !available
            ? row.availability_reason ?? "Model is not currently available"
            : row.health_status === "unknown"
              ? "Awaiting real generation verification"
              : null,
          healthStatus: row.health_status,
          billingUnit: row.billing_unit,
          creditCost: Number(row.price_credits),
          providerPriceCny: Number(row.price_credits),
          accessible: available && authenticated && balance >= minimumCreditCost(row),
          minTier: "free",
          capabilities: {
            textToVideo: true,
            imageToVideo: Boolean(row.supports_input_image),
            videoToVideo: Boolean(row.supports_input_video),
            audio: Boolean(row.supports_audio),
          },
          limits: {
            maxDuration: row.max_duration_seconds ?? 12,
            allowedDurations: durationOptions(row.max_duration_seconds ?? 12),
            maxResolution: row.max_resolution ?? "1080p",
            maxInputImages: row.supports_input_image ? 1 : 0,
          },
        };
      };
      const selectableRows = (await listHealthyModels(options.localDb, "video", { allowUnverified: true })).filter(isSellableVideoModel);
      const selectableIds = new Set(selectableRows.map((row) => row.model_id.toLowerCase()));
      const models = rows.map((row) => toPublicModel(row, selectableIds.has(row.model_id.toLowerCase()))).filter((model): model is NonNullable<typeof model> => Boolean(model));
      const unavailableModels = models.filter((model) => model.availability !== "available");
      return reply.send({
        models: authenticated ? models : models.map((model) => ({ ...model, accessible: false })),
        unavailableModels,
      });
    }

    return reply.send({
      models: getAvailableVideoModels().flatMap((model) => {
        const billing = getConfiguredBilling(model.id);
        if (billing?.billingUnit !== "per_second") return [];
        const creditCost = billing.creditCost ?? getVideoCreditCost(model.id);
        return [{ ...model, ...billing, accessible: authenticated, creditCost, providerPriceCny: creditCost, minTier: "free" }];
      }),
      unavailableModels: [],
    });
  });
}

export function isSellableVideoModel(model: AvailableProviderModel) {
  return !isRemovedModelId(model.model_id)
    && model.billing_unit === "per_second"
    && Number.isFinite(Number(model.price_credits))
    && Number(model.price_credits) > 0
    && Number(model.price_credits) <= 3;
}

function durationOptions(maxDuration: number): number[] {
  return [4, 5, 6, 8, 10, 12, 15, 20, 25, 30].filter((duration) => duration <= maxDuration);
}
