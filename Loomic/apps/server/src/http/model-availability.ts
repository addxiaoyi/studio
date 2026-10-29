import { CONFIGURED_PRICE_MULTIPLIER, calculateConfiguredVideoPricePerSecond, getConfiguredVideoPriceRates, isWithinPublicUnitPriceLimit } from "@helstera/shared";
import type { Pool } from "pg";
import { isRemovedImageModelId, isRemovedModelId } from "../generation/removed-models.js";

export type BillingUnit = "per_generation" | "per_second" | "per_million_tokens";

export type AvailableProviderModel = {
  model_id: string;
  display_name: string;
  billing_unit: BillingUnit;
  price_credits: number;
  input_token_price_cny: number | null;
  output_token_price_cny: number | null;
  supports_input_image?: boolean;
  supports_input_video?: boolean;
  supports_audio?: boolean;
  max_duration_seconds?: number | null;
  max_resolution?: string | null;
  priority?: number;
  health_status?: "unknown" | "healthy" | "degraded" | "unhealthy";
  last_error?: string | null;
  last_succeeded_at?: string | null;
  last_failed_at?: string | null;
  provider_health_status?: string;
  failure_count?: number;
  cooldown_until?: string | null;
};

export type ModelAvailability = AvailableProviderModel & {
  availability: "available" | "unavailable";
  availability_reason: string | null;
};

export function hasValidBilling(row: AvailableProviderModel) {
  if (row.billing_unit === "per_million_tokens") {
    return row.input_token_price_cny != null && row.input_token_price_cny > 0
      && row.output_token_price_cny != null && row.output_token_price_cny > 0;
  }
  return Number.isFinite(Number(row.price_credits)) && Number(row.price_credits) > 0;
}

export function minimumCreditCost(row: AvailableProviderModel) {
  if (row.billing_unit === "per_million_tokens") return 1;
  const configuredRates = row.billing_unit === "per_second" ? getConfiguredVideoPriceRates(row.model_id) : [];
  if (configuredRates.length > 0) {
    return Math.min(...configuredRates.map((rate) => rate.priceCnyPerSecond));
  }
  return row.billing_unit === "per_second" ? Number(row.price_credits) : Number(row.price_credits) * CONFIGURED_PRICE_MULTIPLIER;
}

export function isWithinPublicModelPriceLimit(row: AvailableProviderModel): boolean {
  if (row.billing_unit === "per_million_tokens") return true;
  const priceCny = row.billing_unit === "per_second"
    ? Number(row.price_credits)
    : Number(row.price_credits) * CONFIGURED_PRICE_MULTIPLIER;
  return isWithinPublicUnitPriceLimit(row.billing_unit, priceCny);
}

async function recoverTransientModelStates(db: Pool) {
  await db.query(
    `update provider_models
     set health_status='degraded', failure_count=least(failure_count, 2), cooldown_until=null, updated_at=now()
     where enabled=true and health_status='unhealthy'
       and coalesce(last_error, '') not ilike '%auth%'
       and coalesce(last_error, '') not ilike '%401%'
       and coalesce(last_error, '') not ilike '%403%'
       and coalesce(last_error, '') not ilike '%insufficient%'
       and coalesce(last_error, '') not ilike '%402%'
       and coalesce(last_error, '') not ilike '%model_not_found%'
       and coalesce(last_error, '') not ilike '%no available channel%'`
  );
}
export async function listHealthyModels(
  db: Pool,
  mediaType: "image" | "video",
  options?: { requireBilling?: boolean; requireInputImage?: boolean; allowUnverified?: boolean; allowDegraded?: boolean },
) {
  await recoverTransientModelStates(db);
  const allowDegraded = options?.allowDegraded ?? mediaType !== "image";
  const { rows } = await db.query<AvailableProviderModel>(
    `select * from (
       select distinct on (pm.model_id)
         pm.model_id, pm.display_name, pm.billing_unit,
         pm.price_credits::float8, pm.input_token_price_cny::float8,
         pm.output_token_price_cny::float8, pm.supports_input_image,
         pm.supports_input_video, pm.supports_audio, pm.max_duration_seconds,
         pm.max_resolution, pm.priority, pm.health_status, pm.last_error
       from provider_models pm
       join provider_configs pc on pc.id=pm.provider_id
       where pm.enabled=true and pm.media_type=$1
         and pc.enabled=true and pc.health_status='healthy'
         and pm.health_status <> 'unhealthy'
          and (
            pm.health_status='healthy'
            or ($3 = true and pm.health_status='unknown')
            or ($4 = true and pm.health_status='degraded')
          )
         and pm.failure_count < 3
         and ($2 = false or pm.supports_input_image = true)
         and coalesce(pm.last_error, '') not ilike '%model_not_found%'
         and coalesce(pm.last_error, '') not ilike '%no available channel%'
         and (pm.cooldown_until is null or pm.cooldown_until <= now())
       order by pm.model_id,
         case pm.health_status when 'healthy' then 0 when 'degraded' then 1 when 'unknown' then 2 else 3 end,
         pm.priority,
         pm.failure_count, pc.latency_ms nulls last
     ) available
     order by priority, model_id`,
    [mediaType, options?.requireInputImage === true, options?.allowUnverified === true, allowDegraded],
  );
  const healthEligibleRows = rows.filter((row) => row.health_status === "healthy"
    || (options?.allowUnverified === true && row.health_status === "unknown")
    || (allowDegraded && row.health_status === "degraded"));
  const activeRows = healthEligibleRows.filter((row) => mediaType === "image"
    ? !isRemovedImageModelId(row.model_id)
    : !isRemovedModelId(row.model_id));
  const priceEligibleRows = activeRows
    .filter((row) => mediaType !== "video" || row.billing_unit !== "per_million_tokens")
    .filter(isWithinPublicModelPriceLimit);
  return options?.requireBilling === false ? priceEligibleRows : priceEligibleRows.filter(hasValidBilling);
}

export async function listModelAvailability(db: Pool, mediaType: "image" | "video") {
  await recoverTransientModelStates(db);
  const { rows } = await db.query<AvailableProviderModel>(
    `select distinct on (pm.model_id)
       pm.model_id, pm.display_name, pm.billing_unit,
       pm.price_credits::float8, pm.input_token_price_cny::float8,
       pm.output_token_price_cny::float8, pm.supports_input_image,
       pm.supports_input_video, pm.supports_audio, pm.max_duration_seconds,
       pm.max_resolution, pm.priority, pm.health_status, pm.last_error,
       pm.last_succeeded_at, pm.last_failed_at, pm.failure_count,
       pm.cooldown_until,
       pc.health_status as provider_health_status
     from provider_models pm
     join provider_configs pc on pc.id=pm.provider_id
     where pm.media_type=$1 and pc.enabled=true
       order by pm.model_id,
       case when pc.health_status='healthy' and pm.health_status <> 'unhealthy' and pm.failure_count < 3
         and (pm.cooldown_until is null or pm.cooldown_until <= now()) then 0 else 1 end,
       case when pm.failure_count > 0 then 1 else 0 end,
       pm.priority, pm.failure_count, pc.latency_ms nulls last`,
    [mediaType],
  );
  const activeRows = rows.filter((row) => mediaType === "image"
    ? !isRemovedImageModelId(row.model_id)
    : !isRemovedModelId(row.model_id));
  return activeRows
    .filter((row) => mediaType !== "video" || row.billing_unit !== "per_million_tokens")
    .filter(isWithinPublicModelPriceLimit)
    .map<ModelAvailability>((row) => {
    const available = row.provider_health_status === "healthy"
      && row.health_status === "healthy"
      && Number(row.failure_count ?? 0) < 3
      && (!row.cooldown_until || new Date(row.cooldown_until).getTime() <= Date.now())
      && !/insufficient|402|auth|401|403|model_not_found|no available channel/i.test(row.last_error ?? "");
    return {
      ...row,
      availability: available ? "available" : "unavailable",
      availability_reason: available ? null : publicAvailabilityReason(row),
    };
  });
}

function publicAvailabilityReason(model: AvailableProviderModel) {
  const error = model.last_error?.toLowerCase() ?? "";
  if (error.includes("余额") || error.includes("insufficient") || error.includes("402")) {
    return "上游额度不足，等待恢复";
  }
  if (error.includes("model_not_found") || error.includes("no available channel")) {
    return "上游暂未提供此模型";
  }
  if (model.failure_count && model.failure_count > 0) return "最近调用失败，等待重新验证";
  if (model.provider_health_status !== "healthy") return "生成服务正在恢复";
  if (model.health_status === "unknown") return "等待首次可用性探测";
  if (model.health_status === "degraded") return "近期调用异常，暂时停用";
  return "连续调用失败，等待重新探测";
}

export async function resolveConfiguredModel(
  db: Pool,
  mediaType: "image" | "video",
  requestedModel?: string,
  options?: {
    requiresInputImage?: boolean;
    allowUnverified?: boolean;
    requiredDuration?: number;
    excludeModelIds?: string[];
    allowedModelIds?: string[];
    strictRequested?: boolean;
  },
) {
  // Generation availability is independent from display pricing metadata.
  // A missing price must not prevent a configured upstream model from running.
  const models = await listHealthyModels(db, mediaType, {
    requireBilling: false,
    ...(options?.requiresInputImage !== undefined
      ? { requireInputImage: options.requiresInputImage }
      : {}),
    ...(options?.allowUnverified !== undefined ? { allowUnverified: options.allowUnverified } : {}),
    allowDegraded: mediaType !== "image",
  });
  const imageCandidates = mediaType === "image" && options?.requiresInputImage === false
    ? models.filter((model) => !model.model_id.toLowerCase().includes("4k-超分"))
    : models;
  const durationCandidates = options?.requiredDuration != null
    ? imageCandidates.filter((model) => model.max_duration_seconds == null || model.max_duration_seconds >= options.requiredDuration!)
    : imageCandidates;
  const visibleCandidates = options?.excludeModelIds?.length
    ? durationCandidates.filter((model) => !options.excludeModelIds!.includes(model.model_id))
    : durationCandidates;
  const candidates = options?.allowedModelIds?.length
    ? visibleCandidates.filter((model) => options.allowedModelIds!.includes(model.model_id))
    : visibleCandidates;
  if (requestedModel) {
    const requested = candidates.find((model) =>
      model.model_id === requestedModel || model.model_id.toLowerCase() === requestedModel.toLowerCase(),
    );
    if (requested) return requested;
    if (options?.strictRequested) return null;
  }
  if (options?.allowedModelIds?.length) {
    for (const modelId of options.allowedModelIds) {
      const preferred = candidates.find((model) => model.model_id === modelId);
      if (preferred) return preferred;
    }
  }
  const stableCandidates = candidates.filter((model) => model.health_status !== "degraded");
  return stableCandidates[0] ?? candidates[0] ?? null;
}
