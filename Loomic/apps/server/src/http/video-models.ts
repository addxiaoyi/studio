import { calculateConfiguredVideoPricePerSecond, CONFIGURED_PRICE_MULTIPLIER, getConfiguredBilling, getConfiguredVideoPriceRates, getVideoCreditCost } from "@helstera/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { CreditService } from "../features/credits/credit-service.js";
import { getAvailableVideoModels } from "../generation/providers/registry.js";
import { isRemovedModelId } from "../generation/removed-models.js";
import { type AvailableProviderModel, type ModelAvailability, listHealthyModels, listModelAvailability, minimumCreditCost } from "./model-availability.js";
import { getPublicModelPresentation } from "./public-model-catalog.js";

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
      const rows = dedupePublicModels((await listModelAvailability(options.localDb, "video")).filter(isSellableVideoModel));
      const toPublicModel = (row: ModelAvailability, available: boolean) => {
        const presentation = getPublicModelPresentation(row.model_id, row.display_name, "video");
        if (!presentation) return null;
        const resolutionRates = getConfiguredVideoPriceRates(row.model_id);
        const publicPrice = resolutionRates.find((rate) => rate.resolution === "768p")?.priceCnyPerSecond
          ?? resolutionRates[0]?.priceCnyPerSecond
          ?? Number(row.price_credits);
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
          creditCost: publicPrice,
          providerPriceCny: publicPrice,
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
            maxResolution: resolutionRates.at(-1)?.resolution ?? row.max_resolution ?? "1080p",
            maxInputImages: row.supports_input_image ? 1 : 0,
          },
          ...(resolutionRates.length ? { resolutionRates } : {}),
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
        const resolutionRates = getConfiguredVideoPriceRates(model.id);
        const creditCost = resolutionRates.find((rate) => rate.resolution === "768p")?.priceCnyPerSecond
          ?? resolutionRates[0]?.priceCnyPerSecond
          ?? billing.creditCost
          ?? getVideoCreditCost(model.id);
        return [{
          ...model,
          ...billing,
          accessible: authenticated,
          creditCost,
          providerPriceCny: creditCost,
          minTier: "free",
          ...(resolutionRates.length ? { resolutionRates } : {}),
        }];
      }),
      unavailableModels: [],
    });
  });
}

function dedupePublicModels(rows: ModelAvailability[]): ModelAvailability[] {
  const unique = new Map<string, ModelAvailability>();
  for (const row of rows) {
    const key = row.model_id.trim().toLowerCase();
    const current = unique.get(key);
    if (!current || comparePublicModels(row, current) < 0) unique.set(key, row);
  }
  return [...unique.values()];
}

function comparePublicModels(left: ModelAvailability, right: ModelAvailability) {
  const availabilityRank = (model: ModelAvailability) => model.availability === "available" ? 0 : 1;
  const healthRank = (model: ModelAvailability) => {
    if (model.health_status === "healthy") return 0;
    if (model.health_status === "degraded") return 1;
    if (model.health_status === "unknown") return 2;
    return 3;
  };
  const modelIdRank = (model: ModelAvailability) => Number(model.model_id !== "minimax-h3");
  return availabilityRank(left) - availabilityRank(right)
    || healthRank(left) - healthRank(right)
    || (left.failure_count ?? 0) - (right.failure_count ?? 0)
    || (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER)
    || modelIdRank(left) - modelIdRank(right)
    || left.model_id.localeCompare(right.model_id);
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
