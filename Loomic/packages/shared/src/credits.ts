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
export type VideoResolution = "720p" | "1080p" | "4k";

// ── Model cost table ───────────────────────────────────────
//
// Per-model credits cost in "credits" (1 credit = ¥0.10)
// Different models have different costs reflecting their actual
// API cost and quality tier.
//
// Examples:
//   - Standard models (DALL·E 3, Imagen 3): 5-10 credits
//   - Premium models (gpt-image-1, Veo 3.1): 20-50 credits
//   - HD/4K quality: +50%/+100% over standard
//   - Video (5s standard): 40 credits
//   - Video (10s 4K): 200 credits

export interface ModelCost {
  /** Provider-scoped model id, e.g. "openai/gpt-image-1.5" */
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
    displayName: "Nano Banana Pro",
    provider: "google",
    baseImageCost: 8,
    baseVideoCost: 0,
    qualityMultiplier: { hd: 1.5, ultra: 2.0 },
  },
  {
    modelId: "google-official/gemini-3.1-flash-image-preview",
    displayName: "Nano Banana 2",
    provider: "google",
    baseImageCost: 5,
    baseVideoCost: 0,
    qualityMultiplier: { hd: 1.5, ultra: 2.0 },
  },
  {
    modelId: "google-official/gemini-2.5-flash-image",
    displayName: "Nano Banana",
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
  // OpenAI image
  {
    modelId: "gpt-image-1.5",
    displayName: "GPT Image 1.5",
    provider: "openai",
    baseImageCost: 12,
    baseVideoCost: 0,
    qualityMultiplier: { hd: 1.5, ultra: 2.0 },
  },
  {
    modelId: "gpt-image-1",
    displayName: "GPT Image 1",
    provider: "openai",
    baseImageCost: 10,
    baseVideoCost: 0,
    qualityMultiplier: { hd: 1.5, ultra: 2.0 },
  },
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
  {
    modelId: "doubao-seededit-3-0-i2i-250628",
    displayName: "SeedEdit 3.0",
    provider: "volces",
    baseImageCost: 5,
    baseVideoCost: 0,
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
  const cost = getModelCost(modelId);
  if (!cost) {
    // Unknown model → use a default 5 credits (conservative)
    return 5;
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
  const cost = getModelCost(modelId);
  if (!cost) {
    return 40;
  }
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
  /** Credits granted (1 credit = ¥0.10) */
  credits: number;
  /** Bonus credits (e.g. 100 extra for first purchase) */
  bonusCredits?: number;
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
    credits: 500,
    sortOrder: 1,
  },
  {
    id: "standard-pack",
    name: "标准包",
    priceCnyFen: 20000, // ¥200
    priceUsdCents: 2800, // $28
    credits: 2000, // +200 bonus
    bonusCredits: 200,
    sortOrder: 2,
    recommended: true,
  },
  {
    id: "pro-pack",
    name: "专业包",
    priceCnyFen: 50000, // ¥500
    priceUsdCents: 7000, // $70
    credits: 5500, // +500 bonus (kept ratio within 15% markup)
    bonusCredits: 500,
    sortOrder: 3,
    highlighted: true,
  },
  {
    id: "business-pack",
    name: "商务包",
    priceCnyFen: 100000, // ¥1000
    priceUsdCents: 14000, // $140
    credits: 11500, // +500 bonus
    bonusCredits: 500,
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
    const variant = env[
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

/** Credits granted to new workspaces (one-time signup bonus) */
export const SIGNUP_BONUS_CREDITS = 200;

/** Daily free credits for all users (regardless of balance) */
export const DAILY_FREE_CREDITS = 0; // Disabled — only topup now

/** Credit-to-CNY conversion (1 credit = ¥0.10) */
export const CREDIT_TO_CNY = 0.1;
export const CNY_TO_CREDIT = 10;

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
export function getImageCreditCost(modelId: string, _quality: ImageQualityLevel = "standard"): number {
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
export function canUseResolution(_plan: string, _quality: ImageQualityLevel): boolean {
  return true;
}
/** @deprecated */
export function canUseVideoResolution(_plan: string, _resolution: VideoResolution): boolean {
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
