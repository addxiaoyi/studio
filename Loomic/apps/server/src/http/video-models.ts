import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { CONFIGURED_PRICE_MULTIPLIER, getConfiguredBilling, getVideoCreditCost } from "@helstera/shared";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { CreditService } from "../features/credits/credit-service.js";
import { getAvailableVideoModels } from "../generation/providers/registry.js";
import { listHealthyModels, minimumCreditCost } from "./model-availability.js";
import type { RequestAuthenticator } from "../supabase/user.js";
import { getPublicModelPresentation } from "./public-model-catalog.js";

export async function registerVideoModelRoutes(app: FastifyInstance, options: {
  auth: RequestAuthenticator; creditService: CreditService; viewerService: ViewerService; localDb?: Pool;
}) {
  app.get("/api/video-models", async (request, reply) => {
    let authenticated = false; let balance = 0;
    const configured = options.localDb ? await listHealthyModels(options.localDb, "video") : [];
    try {
      const user = await options.auth.authenticate(request);
      if (user) { const viewer = await options.viewerService.ensureViewer(user); balance = (await options.creditService.getBalance(viewer.workspace.id)).balance; authenticated = true; }
    } catch { authenticated = false; }
    if (options.localDb) {
      const models = configured.flatMap((row) => {
        const presentation = getPublicModelPresentation(row.model_id, row.display_name, "video");
        if (!presentation) return [];
        return [{
        id: row.model_id, displayName: presentation.displayName, description: presentation.description, provider: "configured",
        billingUnit: row.billing_unit, creditCost: row.billing_unit === "per_million_tokens" ? undefined : Number(row.price_credits) * CONFIGURED_PRICE_MULTIPLIER,
        providerPriceCny: row.billing_unit === "per_million_tokens" ? undefined : Number(row.price_credits) * CONFIGURED_PRICE_MULTIPLIER,
        providerInputTokenPriceCny: row.billing_unit === "per_million_tokens" ? Number(row.input_token_price_cny) : undefined,
        providerOutputTokenPriceCny: row.billing_unit === "per_million_tokens" ? Number(row.output_token_price_cny) : undefined,
        accessible: authenticated && balance >= minimumCreditCost(row), minTier: "free",
        capabilities: { textToVideo: true, imageToVideo: Boolean(row.supports_input_image), videoToVideo: Boolean(row.supports_input_video), audio: Boolean(row.supports_audio) },
        limits: { maxDuration: row.max_duration_seconds ?? 12, allowedDurations: durationOptions(row.max_duration_seconds ?? 12), maxResolution: row.max_resolution ?? "1080p", maxInputImages: row.supports_input_image ? 1 : 0 },
        }];
      });
      return reply.send({ models: authenticated ? models : models.map((model) => ({ ...model, accessible: false })) });
    }
    return reply.send({ models: getAvailableVideoModels().map((model) => { const billing = getConfiguredBilling(model.id); const creditCost = billing?.creditCost ?? getVideoCreditCost(model.id); return { ...model, ...(billing ?? {}), accessible: authenticated, creditCost, providerPriceCny: billing?.billingUnit === "per_million_tokens" ? undefined : creditCost, providerInputTokenPriceCny: billing?.inputTokenPriceCny, providerOutputTokenPriceCny: billing?.outputTokenPriceCny, minTier: "free" }; }) });
  });
}

function durationOptions(maxDuration: number): number[] {
  return [4, 5, 6, 8].filter((duration) => duration <= maxDuration);
}
