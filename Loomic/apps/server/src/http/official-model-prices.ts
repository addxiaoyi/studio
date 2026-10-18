import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { CONFIGURED_PRICE_MULTIPLIER } from "@helstera/shared";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import { isRemovedImageModelId, isRemovedModelId } from "../generation/removed-models.js";
import { loadOfficialModelPriceCatalog, syncOfficialModelPrices } from "../local-db/official-model-prices.js";
import type { RequestAuthenticator } from "../auth/types.js";
import { isWithinPublicModelPriceLimit } from "./model-availability.js";

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function registerOfficialModelPriceRoutes(
  app: FastifyInstance,
  options: { db: Pool; autoSync: boolean; auth: RequestAuthenticator; viewerService: ViewerService },
): void {
  app.get("/api/public/model-prices", async (request, reply) => {
    try {
      return reply.send({ ok: true, data: await loadOfficialModelPriceCatalog(options.db) });
    } catch (error) {
      request.log.error({ error }, "failed to load public model pricing catalog");
      return reply.code(503).send({
        ok: false,
        error: { code: "model_pricing_unavailable", message: "官方价格表暂时不可用，请稍后重试。" },
      });
    }
  });

  app.get("/api/workspace/model-prices", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.send({ ok: true, data: { authenticated: false, models: [] } });

    const viewer = await options.viewerService.ensureViewer(user);
    const { rows } = await options.db.query<WorkspaceModelPriceRow>(
      `select pm.model_id,pm.display_name,pm.media_type,pm.billing_unit,
              pm.price_credits::float8 as price_credits,
              pm.input_token_price_cny::float8 as input_token_price_cny,
              pm.output_token_price_cny::float8 as output_token_price_cny,
              pm.enabled as model_enabled,pm.health_status as model_health,
              pc.label as provider_label,pc.enabled as provider_enabled,pc.health_status as provider_health
         from provider_models pm
         join provider_configs pc on pc.id=pm.provider_id
        where pc.workspace_id=$1
          and pm.enabled=true
          and pc.enabled=true
        order by pm.media_type,pm.priority,pm.display_name,pc.label`,
      [viewer.workspace.id],
    );
    const models = rows
      .filter((row) => row.billing_unit !== "per_million_tokens")
      .filter(isWithinPublicModelPriceLimit)
      .filter((row) => row.media_type === "image"
        ? !isRemovedImageModelId(row.model_id)
        : !isRemovedModelId(row.model_id))
      .map(toWorkspaceModelPrice);
    const uniqueModels = dedupeWorkspaceModelPrices(models);

    return reply.send({ ok: true, data: { authenticated: true, models: uniqueModels } });
  });

  if (!options.autoSync) return;

  let timer: NodeJS.Timeout | undefined;
  const syncPrices = async () => {
    try {
      const summary = await syncOfficialModelPrices(options.db);
      if (summary.failed > 0) {
        app.log.warn(summary, "official model price sync completed with unavailable sources");
        return;
      }
      app.log.info(summary, "official model price sync completed");
    } catch (error) {
      app.log.error({ error }, "official model price sync failed");
    }
  };

  app.addHook("onReady", async () => {
    void syncPrices();
    timer = setInterval(() => void syncPrices(), SYNC_INTERVAL_MS);
    timer.unref();
  });
  app.addHook("onClose", async () => {
    if (timer) clearInterval(timer);
  });
}

type WorkspaceModelPriceRow = {
  model_id: string;
  display_name: string;
  media_type: "image" | "video";
  billing_unit: "per_generation" | "per_second" | "per_million_tokens";
  price_credits: number;
  input_token_price_cny: number | null;
  output_token_price_cny: number | null;
  model_enabled: boolean;
  provider_enabled: boolean;
  model_health: string;
  provider_health: string;
  provider_label: string;
};

export function toWorkspaceModelPrice(row: WorkspaceModelPriceRow) {
  const isTokenBilled = row.billing_unit === "per_million_tokens";
  const unitMultiplier = row.billing_unit === "per_generation" ? CONFIGURED_PRICE_MULTIPLIER : 1;
  return {
    modelId: row.model_id,
    displayName: row.display_name,
    providerLabel: row.provider_label,
    mediaType: row.media_type,
    billingUnit: row.billing_unit,
    priceCny: isTokenBilled ? null : Number(row.price_credits) * unitMultiplier,
    inputPriceCny: isTokenBilled && row.input_token_price_cny != null
      ? Number(row.input_token_price_cny) * CONFIGURED_PRICE_MULTIPLIER
      : null,
    outputPriceCny: isTokenBilled && row.output_token_price_cny != null
      ? Number(row.output_token_price_cny) * CONFIGURED_PRICE_MULTIPLIER
      : null,
    modelEnabled: row.model_enabled,
    providerEnabled: row.provider_enabled,
    modelHealth: row.model_health,
    providerHealth: row.provider_health,
  };
}

type WorkspaceModelPrice = ReturnType<typeof toWorkspaceModelPrice>;

export function dedupeWorkspaceModelPrices(models: WorkspaceModelPrice[]): WorkspaceModelPrice[] {
  const unique = new Map<string, WorkspaceModelPrice>();
  for (const model of models) {
    const key = `${model.mediaType}:${model.modelId.trim().toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, model);
  }
  return [...unique.values()];
}
