// @credits-system — Top-up credit system: model-based pricing + transaction history
import { z } from "zod";

// ── Transaction types ──────────────────────────────────────

export type CreditTransactionType =
  | "topup"
  | "generation_deduct"
  | "generation_refund"
  | "admin_adjustment"
  | "bonus";

/** @deprecated Use CreditTransactionType */
export const creditTransactionTypeSchema = {
  parse: () => "topup" as CreditTransactionType,
};

// ── Quality / resolution types ──────────────────────────────

export type ImageQualityLevel = "standard" | "hd" | "ultra";
export type VideoResolution = "480p" | "720p" | "768p" | "1080p" | "1088p" | "1440p" | "2160p" | "4k";

// ── Model cost table ───────────────────────────────────────
//
// Per-model credits cost in "credits" (1 credit = ¥1.00)
// Different models have different costs reflecting their actual
// API cost and quality tier.
//
// Examples:
//   - Standard models (DALL·E 3, Imagen 3): 5-10 credits
//   - Premium image and video models: model-specific credits
//   - HD/4K quality: +50%/+100% over standard
//   - Video (5s standard): 40 credits
//   - Video (10s 4K): 200 credits

export interface ModelCost {
  /** Provider-scoped model id, e.g. "openai/gpt-image-2" */
  modelId: string;
  /** Base cost per image generation (1K equivalent) */
  baseImageCost: number;
  /** Base cost per video generation (5s 720p equivalent) */
  baseVideoCost: number;
  /** Quality multiplier (hd = 1.5, ultra = 2.0) */
  qualityMultiplier?: Partial<Record<ImageQualityLevel, number>>;
  /** Resolution multiplier for video */
  videoResolutionMultiplier?: Partial<Record<VideoResolution, number>>;
  /** Display name for UI */
  displayName: string;
  /** Provider name for grouping */
  provider: string;
  /** Whether the model is currently available (not deprecated) */
  enabled?: boolean;
}

// ── Default model cost catalog ──────────────────────────────

export const MODEL_COSTS: ModelCost[] = [
  // Google Gemini image
  {
    modelId: "google-official/gemini-3-pro-image-preview",
    displayName: "Gemini Image Pro (retired)",
    provider: "google",
    baseImageCost: 8,
    baseVideoCost: 0,
    qualityMultiplier: { hd: 1.5, ultra: 2.0 },
  },
  {
    modelId: "google-official/gemini-3.1-flash-image-preview",
    displayName: "Gemini Flash Image (retired)",
    provider: "google",
    baseImageCost: 5,
    baseVideoCost: 0,
    qualityMultiplier: { hd: 1.5, ultra: 2.0 },
  },
  {
    modelId: "google-official/gemini-2.5-flash-image",
    displayName: "Gemini Flash Image (retired)",
    provider: "google",
    baseImageCost: 5,
    baseVideoCost: 0,
    qualityMultiplier: { hd: 1.5, ultra: 2.0 },
  },
  // Google Vertex image (Vertex Pricing)
  {
    modelId: "google-vertex/imagen-4.0-generate-preview-06-06",
    displayName: "Imagen 4",
    provider: "google-vertex",
    baseImageCost: 6,
    baseVideoCost: 0,
    qualityMultiplier: { hd: 1.5, ultra: 2.5 },
  },
  // GPT Image 1 is retired from the public catalog; historical billing remains unchanged.
  {
    modelId: "dall-e-3",
    displayName: "DALL·E 3",
    provider: "openai",
    baseImageCost: 8,
    baseVideoCost: 0,
    qualityMultiplier: { hd: 1.5, ultra: 2.0 },
  },
  // Volces (Doubao) image
  {
    modelId: "doubao-seedream-3-0-t2i-250415",
    displayName: "Seedream 3.0",
    provider: "volces",
    baseImageCost: 4,
    baseVideoCost: 0,
    qualityMultiplier: { hd: 1.3, ultra: 1.8 },
  },
  // Google video
  {
    modelId: "google-official/veo-3.1-generate-preview",
    displayName: "Veo 3.1",
    provider: "google",
    baseImageCost: 0,
    baseVideoCost: 50,
    videoResolutionMultiplier: { "720p": 1.0, "1080p": 1.5, "4k": 2.5 },
  },
  // Replicate video
  {
    modelId: "kwaivgi/kling-v2.6",
    displayName: "Kling 2.6",
    provider: "replicate",
    baseImageCost: 0,
    baseVideoCost: 40,
    videoResolutionMultiplier: { "720p": 1.0, "1080p": 1.4, "4k": 2.0 },
  },
  // Metaso video
  {
    modelId: "metaso/MiniMax-H3",
    displayName: "MiniMax H3",
    provider: "metaso",
    baseImageCost: 0,
    baseVideoCost: 60,
    videoResolutionMultiplier: { "720p": 1.0, "1080p": 1.5, "4k": 2.5 },
  },
];

// Authoritative CNY billing catalog. One credit equals one CNY.
// Public prices are fixed at 2x the upstream catalog.
export const CONFIGURED_PRICE_MULTIPLIER = 1;
export const GROSS_MARGIN_COST_DIVISOR = 0.25;

/** Dynamic final price policy for video models billed per second. */
export const VIDEO_MARGIN_THRESHOLD_CNY_PER_SECOND = 0.8;
export const VIDEO_LOW_COST_GROSS_MARGIN = 0.8;
export const VIDEO_HIGH_COST_GROSS_MARGIN = 0.6;

export function calculateConfiguredVideoPricePerSecond(providerCostCny: number): number {
  if (!Number.isFinite(providerCostCny) || providerCostCny <= 0) {
    throw new Error("Provider video cost per second must be greater than 0");
  }
  const grossMargin = providerCostCny < VIDEO_MARGIN_THRESHOLD_CNY_PER_SECOND
    ? VIDEO_LOW_COST_GROSS_MARGIN
    : VIDEO_HIGH_COST_GROSS_MARGIN;
  return Number((providerCostCny / (1 - grossMargin)).toFixed(4));
}

/** Final user-facing price for one agent message, in CNY/credits. */
export const DEFAULT_AGENT_MESSAGE_PRICE_CNY = 0.01;

export const HELSTERA_AGENT_TOKEN_PRICES_CNY = {
  input: 0.1,
  output: 0.5,
} as const;

export function calculateAgentTokenCharge(inputTokens: number, outputTokens: number): number {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(outputTokens) || outputTokens < 0) {
    throw new Error("Agent token usage must be non-negative safe integers");
  }
  const raw = (inputTokens * HELSTERA_AGENT_TOKEN_PRICES_CNY.input
    + outputTokens * HELSTERA_AGENT_TOKEN_PRICES_CNY.output) / 1_000_000;
  return Number((Math.ceil(raw * 10_000) / 10_000).toFixed(4));
}

export const CONFIGURED_AGENT_MESSAGE_PRICES_CNY: Readonly<Record<string, number>> = {
  hy3: 0.01,
  "minimax-hy3": 0.01,
  "agnes-3.0-flash": 0.1,
};

export function getAgentMessagePrice(modelId: string | null | undefined): number {
  const normalized = modelId?.replace(/^openai:/, "").trim().toLowerCase();
  if (!normalized) return DEFAULT_AGENT_MESSAGE_PRICE_CNY;
  return CONFIGURED_AGENT_MESSAGE_PRICES_CNY[normalized] ?? DEFAULT_AGENT_MESSAGE_PRICE_CNY;
}

export const CONFIGURED_IMAGE_COSTS: Readonly<Record<string, number>> = {
  "nano-banana-2-1k": 0.1,
  "nano-banana-2-2k": 0.2,
  "gpt-image-2": 0.05,
  "gpt-image-2-1k": 0.05,
  "gpt-image-2-2k": 0.08,
  "gpt-image-2-4k": 0.3,
  "gpt-image-2-4k-超分": 0.2,
  "gpt-image-2.5-1k": 0.04,
  "gpt-image-2.5-2k": 0.08,
  "gpt-image-2.5-4k": 0.2,
};

export const CONFIGURED_VIDEO_COSTS: Readonly<Record<string, number>> = {

  "sora-2-12s": 0.8,
  "omni_flash-10s": 1.2,
  "omni-flash": 0.36,
  "omni-1.1": 0.27,
  "omni_flash-10s-fl": 0.765,
  "wan2.7-cankaosheng": 1.35,
  "pixverse-c1-cankaosheng": 0.684,
  "pixverse-c1-shouweizhen": 0.684,
  "viduq2-cankaosheng": 0.903,
  "wan2.7-shouweizhen": 1.35,
  "kling-v3-omni-cankao": 3,
  "kling-v3-video": 3.37,
  "viduq3": 0.3,
  "wan2.6-cankaosheng": 0.41,
  "kling-v3-omni-shouweizhen": 3,
  "viduq3-turbo": 0.09,
  "vo3.1": 0.6,
  "viduq3-cankaosheng": 0.52,
  "wan2.7-xuxie": 1.35,
};

export const CONFIGURED_VIDEO_SECOND_COSTS: Readonly<Record<string, number>> = {

  "minimax-h3": 0.09,
  "seedance-2.5-guanfang-anmiao": 0.51,
  "hailuo-h3-cankaosheng": 0.09,
  "hailuo-h3": 0.09,
  "hailuo-h3-quannengcankao": 0.09,
  "hailuo-h3-shouweizhen": 0.09,
  "happyhorse-1.1-i2v": 0.75,
  "seedance-2.5-anmiao": 0.51,
  "pixverse-v6-shouweizhen": 0.2,
  "viduq3-drama": 0.722,
  "seedance-2.5-anmiao-quannengcankao": 0.51,
  "hailuo-h3-max": 0.495,
  "hailuo-h3-max-shouweizhen": 0.495,
  "pixverse-v5.6-shouweizhen": 0.564,
  "happyhorse-i2v": 0.783,
  "seedance-2.5-anmiao-shouweizhen": 0.51,
  "seedance-2.5-anmiao-wensheng": 0.51,

  "doubao-seedance-1-5-pro-251215": 0.1179,
  "seedance-2.0-guanfang-anmiao": 0.18,
  "seedance-2.0-anmiao-cankaosheng": 0.1823,
  "seedance-2.0-anmiao-quannengcankao": 0.18,
  "seedance-2.0-anmiao": 0.1823,
  "happyhorse-r2v": 0.783,
  "viduq3-turbo-cankaosheng": 0.09,
  "wan3.0": 0.45,
  "video-enhance": 0.0207,
  "kling-avatar-image2video": 0.45,
  "kling-v3-omni-videoref": 0.6735,
  "wan3.0-video-quannengcankao": 0.45,
  "happyhorse-t2v": 0.783,
  "happyhorse-1.1-t2v": 0.75,
  "happyhorse-1.1-r2v": 0.75,
  "kling-motion-control-v3": 0.6735,
  "happyhorse-video-edit": 0.783,
  "vidu-mv": 0.1548,
  "wan2.2-animate-mix": 0.315,
  "kling-motion-control": 0.6,
  "wan2.6-shouzheng": 0.47,
  "wan3.0-video": 0.45,
  "pixverse-v5.6-r2v": 0.564,
  "hailuo-h3-zaishengcheng": 0.345,
  "wan3.0-video-cankaosheng": 0.45,
  "vidu-jieshuoman": 0.5157,
  "wan3.0-video-shouweizhen": 0.45,
};

const CONFIGURED_VIDEO_PRICE_OVERRIDES_CNY_PER_SECOND: Readonly<Record<string, number>> = {
  // Cost is the lowest published route rate; target 50% gross margin on that rate.
  "seedance-2.5-guanfang-anmiao": 0.9792,
};

export const CONFIGURED_TOKEN_PRICES_CNY: Readonly<Record<string, { input: number; output: number }>> = {
  helsteragent: HELSTERA_AGENT_TOKEN_PRICES_CNY,
  "agnes-3.0-flash": { input: 0.1, output: 0.1 },
  // Kuaipao NewAPI channel: ¥0.80/M final price after the platform 2x markup.

  "nano-banana-2": { input: 15, output: 15 },
  "doubao-seedance-2.0-1080p": { input: 72, output: 72 },
  "doubao-seedance-2.0-480p": { input: 55.5, output: 55.5 },
  "doubao-seedance-2.0-720p": { input: 49.6, output: 49.6 },
  "doubao-seedance-2.0-fast-480p": { input: 44.4, output: 44.4 },
  "doubao-seedance-2.0-fast-720p": { input: 28, output: 28 },
  "doubao-seedance-2.0-mini": { input: 75, output: 75 },
  "doubao-seedance-2.0-mini-480p": { input: 27.75, output: 27.75 },
  "doubao-seedance-2.0-mini-720p": { input: 25.5, output: 25.5 },
  "doubao-seedance-2.5-480p": { input: 60, output: 60 },
  "doubao-seedance-2.5-720p": { input: 74.4, output: 74.4 },
};
export const TOKEN_BILLING_RESERVE_CREDITS = 1;

export function getConfiguredBilling(modelId: string) {
  const upstream = getUpstreamCost(modelId);
  if (upstream) {
    const sellPrice = getUpstreamSellPrice(modelId)!;
    if (upstream.unit === "per_million_tokens") {
      return { billingUnit: "per_million_tokens" as const, inputTokenPriceCny: sellPrice, outputTokenPriceCny: sellPrice };
    }
    return { billingUnit: upstream.unit, creditCost: sellPrice } as const;
  }
  const tokenPrice = CONFIGURED_TOKEN_PRICES_CNY[modelId];
  if (tokenPrice)
    return {
      billingUnit: "per_million_tokens" as const,
      inputTokenPriceCny: tokenPrice.input * CONFIGURED_PRICE_MULTIPLIER,
      outputTokenPriceCny: tokenPrice.output * CONFIGURED_PRICE_MULTIPLIER,
    };
  const imagePrice = CONFIGURED_IMAGE_COSTS[modelId];
  if (imagePrice !== undefined)
    return { billingUnit: "per_generation" as const, creditCost: Number((imagePrice / GROSS_MARGIN_COST_DIVISOR).toFixed(4)) };
  const videoPrice = CONFIGURED_VIDEO_COSTS[modelId];
  if (videoPrice !== undefined)
    return { billingUnit: "per_generation" as const, creditCost: videoPrice * CONFIGURED_PRICE_MULTIPLIER };
  const priceOverride = CONFIGURED_VIDEO_PRICE_OVERRIDES_CNY_PER_SECOND[modelId];
  if (priceOverride !== undefined)
    return { billingUnit: "per_second" as const, creditCost: priceOverride };
  const secondPrice = CONFIGURED_VIDEO_SECOND_COSTS[modelId];
  if (secondPrice !== undefined)
    return { billingUnit: "per_second" as const, creditCost: calculateConfiguredVideoPricePerSecond(secondPrice) };
  return null;
}

/**
 * Look up the cost config for a model.
 */
export function getModelCost(modelId: string): ModelCost | null {
  return MODEL_COSTS.find((m) => m.modelId === modelId) ?? null;
}

/**
 * Calculate the credit cost for an image generation.
 */
export function calculateImageCost(
  modelId: string,
  quality: ImageQualityLevel = "standard",
): number {
  const upstream = getUpstreamCost(modelId);
  if (upstream) {
    return upstream.unit === "per_million_tokens" ? TOKEN_BILLING_RESERVE_CREDITS : getUpstreamSellPrice(modelId)!;
  }
  if (CONFIGURED_TOKEN_PRICES_CNY[modelId]) {
    return TOKEN_BILLING_RESERVE_CREDITS;
  }
  const configuredCost = CONFIGURED_IMAGE_COSTS[modelId];
  if (configuredCost !== undefined) return Number((configuredCost / GROSS_MARGIN_COST_DIVISOR).toFixed(4));
  const cost = getModelCost(modelId);
  if (!cost) {
    throw new Error(`Model is not configured for billing: ${modelId}`);
  }
  const mult = cost.qualityMultiplier?.[quality] ?? 1.0;
  return Math.ceil(cost.baseImageCost * mult);
}

/**
 * Calculate the credit cost for a video generation.
 */
export function calculateVideoCost(
  modelId: string,
  resolution: VideoResolution = "720p",
  durationSeconds = 5,
): number {
  const upstream = getUpstreamCost(modelId);
  if (upstream) {
    if (upstream.unit === "per_million_tokens") return TOKEN_BILLING_RESERVE_CREDITS;
    return getUpstreamSellPrice(modelId, resolution)! * durationSeconds;
  }
  if (CONFIGURED_TOKEN_PRICES_CNY[modelId]) {
    return TOKEN_BILLING_RESERVE_CREDITS;
  }
  const configuredCost = CONFIGURED_VIDEO_COSTS[modelId];
  if (configuredCost !== undefined) return configuredCost * CONFIGURED_PRICE_MULTIPLIER;
  const priceOverride = CONFIGURED_VIDEO_PRICE_OVERRIDES_CNY_PER_SECOND[modelId];
  if (priceOverride !== undefined) return priceOverride * durationSeconds;
  const secondPrice = CONFIGURED_VIDEO_SECOND_COSTS[modelId];
  if (secondPrice !== undefined) return calculateConfiguredVideoPricePerSecond(secondPrice) * durationSeconds;
  const cost = getModelCost(modelId);
  if (!cost) throw new Error(`Model is not configured for billing: ${modelId}`);
  const baseMult = cost.videoResolutionMultiplier?.[resolution] ?? 1.0;
  // Video cost scales linearly with duration (5s = 1x, 10s = 2x)
  const durationMult = durationSeconds / 5;
  return Math.ceil(cost.baseVideoCost * baseMult * durationMult);
}

// ── Top-up catalog ──────────────────────────────────────────

export interface TopupPackage {
  /** Unique package id */
  id: string;
  /** Display name (e.g. "标准包") */
  name: string;
  /** CNY price (in fen = cents) */
  priceCnyFen: number;
  /** USD price (in cents) */
  priceUsdCents: number;
  /** Credits granted (1 credit = ¥1.00) */
  credits: number;
  /** Sort order */
  sortOrder: number;
  /** Whether this is a "best value" package */
  highlighted?: boolean;
  /** Whether this is the recommended for new users */
  recommended?: boolean;
  /**
   * Lemon Squeezy variant id for international checkout.
   * Set via env `LEMON_SQUEEZY_TOPUP_VARIANT_<id>`.
   * If undefined, the package is unavailable for international checkout.
   */
  lemonSqueezyVariantId?: string;
}

export const TOPUP_PACKAGES: TopupPackage[] = [
  {
    id: "starter-pack",
    name: "体验包",
    priceCnyFen: 5000, // ¥50
    priceUsdCents: 700, // $7
    credits: 50,
    sortOrder: 1,
  },
  {
    id: "standard-pack",
    name: "标准包",
    priceCnyFen: 20000, // ¥200
    priceUsdCents: 2800, // $28
    credits: 200,
    sortOrder: 2,
    recommended: true,
  },
  {
    id: "pro-pack",
    name: "专业包",
    priceCnyFen: 50000, // ¥500
    priceUsdCents: 7000, // $70
    credits: 500,
    sortOrder: 3,
    highlighted: true,
  },
  {
    id: "business-pack",
    name: "商务包",
    priceCnyFen: 100000, // ¥1000
    priceUsdCents: 14000, // $140
    credits: 1000,
    sortOrder: 4,
  },
];

/**
 * Apply env-driven Lemon Squeezy variant IDs to packages.
 * Reads from `LEMON_SQUEEZY_TOPUP_VARIANT_<package_id_uppercase>`.
 */
export function applyTopupVariants(
  env: Record<string, string | undefined>,
): TopupPackage[] {
  return TOPUP_PACKAGES.map((pkg) => {
    const variant =
      env[
        `LEMON_SQUEEZY_TOPUP_VARIANT_${pkg.id.replace(/-/g, "_").toUpperCase()}`
      ];
    if (!variant) return pkg;
    return { ...pkg, lemonSqueezyVariantId: variant };
  });
}

/**
 * Look up a top-up package by id.
 */
export function getTopupPackage(id: string): TopupPackage | null {
  return TOPUP_PACKAGES.find((p) => p.id === id) ?? null;
}

// ── Free credits ────────────────────────────────────────────

/** Credits granted to new workspaces. Top-up balance is funded only by payment. */
export const SIGNUP_BONUS_CREDITS = 0;

/** Daily free credits for all users (regardless of balance) */
export const DAILY_FREE_CREDITS = 0; // Disabled — only topup now

/** Credit-to-CNY conversion (1 credit = ¥1.00). */
export const CREDIT_TO_CNY = 1;
export const CNY_TO_CREDIT = 1;

/** Convert provider token pricing to credits, rounding up to avoid underbilling. */
export function calculateTokenCredits(
  inputTokens: number,
  outputTokens: number,
  inputCnyPerMillionTokens: number,
  outputCnyPerMillionTokens = inputCnyPerMillionTokens,
): number {
  if (
    ![inputTokens, outputTokens, inputCnyPerMillionTokens, outputCnyPerMillionTokens].every(Number.isFinite)
  ) {
    throw new Error("Token usage and price must be finite numbers");
  }
  if (inputTokens < 0 || outputTokens < 0 || inputCnyPerMillionTokens < 0 || outputCnyPerMillionTokens < 0) {
    throw new Error("Token usage and price cannot be negative");
  }
  const cny =
    (inputTokens / 1_000_000) * inputCnyPerMillionTokens +
    (outputTokens / 1_000_000) * outputCnyPerMillionTokens;
  return Math.ceil(cny * CNY_TO_CREDIT * 10_000) / 10_000;
}

// ── Transaction record (DB shape) ───────────────────────────

/**
 * Database row from credit_transactions table.
 * Kept as a type-only interface for the top-up system (the new model).
 */
export interface CreditTransaction {
  id: string;
  transaction_type: CreditTransactionType;
  amount: number;
  balance_after: number | null;
  job_id: string | null;
  description: string | null;
  created_at: number;
}

// ── Legacy compatibility shims ─────────────────────────────
//
// Many existing server/UI files still import subscription-related
// names. Re-export them as harmless defaults so the rest of the
// codebase can be migrated incrementally without breaking the
// build. New code should NOT use these — switch to topup/credits
// APIs.

/** @deprecated Use TOPUP_PACKAGES */
export const PLAN_CONFIGS = TOPUP_PACKAGES;
/** @deprecated Use getModelCost */
export const MODEL_MIN_TIER: Record<string, string> = {};
/** @deprecated Plans no longer exist. */
export type SubscriptionPlan = "free";
/** @deprecated Period no longer exists. */
export type BillingPeriod = "monthly" | "yearly";
/** @deprecated */
export const subscriptionPlanSchema = z
  .unknown()
  .transform((): SubscriptionPlan => "free")
  .pipe(z.enum(["free"]));
/** @deprecated */
export const billingPeriodSchema = z
  .unknown()
  .transform((): BillingPeriod => "monthly")
  .pipe(z.enum(["monthly"]));
/** @deprecated Use calculateImageCost */
export function getImageCreditCost(
  modelId: string,
  _quality: ImageQualityLevel = "standard",
): number {
  return calculateImageCost(modelId, _quality);
}
/** @deprecated Use calculateVideoCost */
export function getVideoCreditCost(
  modelId: string,
  duration?: number,
  resolution?: VideoResolution,
): number {
  return calculateVideoCost(modelId, resolution, duration);
}
/** @deprecated */
export function canAccessModel(_plan: string, _modelId: string): boolean {
  return true;
}
/** @deprecated */
export function canUseResolution(
  _plan: string,
  _quality: ImageQualityLevel,
): boolean {
  return true;
}
/** @deprecated */
export function canUseVideoResolution(
  _plan: string,
  _resolution: VideoResolution,
): boolean {
  return true;
}
/** @deprecated */
export function getPlanConfig(): TopupPackage[] {
  return TOPUP_PACKAGES;
}

// ── Currency conversion ─────────────────────────────────────

/** Default USD/CNY exchange rate. Update periodically or source from API. */
export const USD_CNY_RATE = 7.2;

/**
 * Convert CNY fen (1/100 yuan) to USD cents using the static rate.
 * Includes a 5% buffer to cover FX + payment processor margin.
 */
export function getUsdCentsForCnyFen(cnyFen: number): number {
  if (cnyFen <= 0) return 0;
  const cnyYuan = cnyFen / 100;
  const usd = cnyYuan / USD_CNY_RATE;
  return Math.round(usd * 100 * 1.05);
}
import { getUpstreamCost, getUpstreamSellPrice } from "./upstream-pricing.js";
