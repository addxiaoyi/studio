import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { CONFIGURED_PRICE_MULTIPLIER, getImageCreditCost, getConfiguredBilling } from "@helstera/shared";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { CreditService } from "../features/credits/credit-service.js";
import { getAvailableImageModels } from "../generation/providers/registry.js";
import { listHealthyModels, minimumCreditCost } from "./model-availability.js";
import type { RequestAuthenticator } from "../supabase/user.js";
import { getPublicModelPresentation } from "./public-model-catalog.js";

export async function registerImageModelRoutes(app: FastifyInstance, options: {
  auth: RequestAuthenticator; creditService: CreditService; viewerService: ViewerService; localDb?: Pool;
}) {
  app.get("/api/image-models", async (request, reply) => {
    let authenticated = false; let balance = 0;
    const configured = options.localDb ? await listHealthyModels(options.localDb, "image") : [];
    try {
      const user = await options.auth.authenticate(request);
      if (user) { const viewer = await options.viewerService.ensureViewer(user); balance = (await options.creditService.getBalance(viewer.workspace.id)).balance; authenticated = true; }
    } catch { authenticated = false; }
    if (options.localDb && configured.length > 0) {
      const defaultModel = configured[0]?.model_id ?? "black-forest-labs/flux-kontext-pro";
      const models = configured.flatMap((row) => {
        const presentation = getPublicModelPresentation(row.model_id, row.display_name, "image") ?? {
          displayName: row.display_name || row.model_id,
          description: "已配置的图片生成模型",
        };
        return [{
        id: row.model_id, displayName: presentation.displayName, description: presentation.description, iconUrl: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/openai.svg", provider: "configured",
        billingUnit: row.billing_unit, creditCost: row.billing_unit === "per_million_tokens" ? undefined : Number(row.price_credits) * CONFIGURED_PRICE_MULTIPLIER,
        providerPriceCny: row.billing_unit === "per_million_tokens" ? undefined : Number(row.price_credits) * CONFIGURED_PRICE_MULTIPLIER,
        providerInputTokenPriceCny: row.billing_unit === "per_million_tokens" ? Number(row.input_token_price_cny) : undefined,
        providerOutputTokenPriceCny: row.billing_unit === "per_million_tokens" ? Number(row.output_token_price_cny) : undefined,
        accessible: authenticated && balance >= minimumCreditCost(row), minTier: "free",
        }];
      });
      // Keep the catalog visible even when the account cannot currently afford a
      // model. The client needs the model choice and capability metadata; the
      // generation endpoint remains responsible for authorization and charging.
      return reply.send({ defaultModel, models: authenticated ? models : models.map((model) => ({ ...model, accessible: false })) });
    }
    return reply.send({ defaultModel: "black-forest-labs/flux-kontext-pro", models: getAvailableImageModels().map((model) => { const billing = getConfiguredBilling(model.id); const creditCost = billing?.creditCost ?? getImageCreditCost(model.id, "hd"); return { ...model, ...(billing ?? {}), accessible: authenticated, creditCost, providerPriceCny: billing?.billingUnit === "per_million_tokens" ? undefined : creditCost, providerInputTokenPriceCny: billing?.inputTokenPriceCny, providerOutputTokenPriceCny: billing?.outputTokenPriceCny, minTier: "free" }; }) });
  });
}
