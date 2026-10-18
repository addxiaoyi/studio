// @credits-system — Pricing rules: per-model cost + concurrent jobs
// In the top-up credit system, all models are available to all users
// (no plan-based access control). Only credit balance + concurrency is enforced.
import type {
  BackgroundJobType,
  ImageQualityLevel,
  VideoResolution,
} from "@helstera/shared";
import {
  calculateImageCost,
  calculateVideoCost,
  CONFIGURED_PRICE_MULTIPLIER,
  calculateConfiguredVideoPricePerSecond,
  getConfiguredBilling,
  TOKEN_BILLING_RESERVE_CREDITS,
} from "@helstera/shared";

import type { DataAdminClient } from "../../auth/types.js";
import type { Pool } from "pg";

/**
 * Default maximum concurrent jobs per workspace.
 * With the top-up model, we use a flat limit (not plan-based).
 */
export const DEFAULT_MAX_CONCURRENT_JOBS = 8;

// ── Types ────────────────────────────────────────────────────

/** @deprecated Old TierGuard type — kept for back-compat. */
export type TierGuard = CostGuard;

export type CostGuard = {
  /** No-op: all models are accessible in the top-up system. */
  checkModelAccess(modelId: string): Promise<void>;
  /** No-op: any quality is available. */
  checkResolution(quality: ImageQualityLevel): void;
  /** No-op: any video resolution is available. */
  checkVideoResolution(resolution: VideoResolution): void;
  /** Enforce workspace concurrent job limit. */
  checkConcurrency(workspaceId: string): Promise<void>;
  /** Calculate the credit cost for a generation. */
  calculateCreditCost(
    modelId: string,
    jobType: BackgroundJobType,
    params?: {
      quality?: ImageQualityLevel;
      duration?: number;
      resolution?: VideoResolution;
    },
  ): Promise<number>;
};

// ── Factory ──────────────────────────────────────────────────

export function createCostGuard(options: {
  getAdminClient: () => DataAdminClient;
}): CostGuard {
  return {
    async checkModelAccess() {
      // No-op: all models are accessible in the top-up system
    },

    checkResolution() {
      // No-op: any quality is available
    },

    checkVideoResolution() {
      // No-op: any video resolution is available
    },

    async checkConcurrency(workspaceId) {
      const admin = options.getAdminClient();
      const { count, error } = await admin
        .from("background_jobs")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .in("status", ["queued", "running"]);

      if (error) {
        console.error(
          "[cost-guard] Failed to check concurrency:",
          error.message,
        );
        return;
      }

      const activeCount = count ?? 0;
      if (activeCount >= DEFAULT_MAX_CONCURRENT_JOBS) {
        throw new Error(
          `Concurrent job limit reached (${activeCount}/${DEFAULT_MAX_CONCURRENT_JOBS}). Please wait for a job to finish.`,
        );
      }
    },

    async calculateCreditCost(modelId, jobType, params) {
      if (jobType === "image_generation") {
        const quality: ImageQualityLevel = params?.quality ?? "hd";
        return calculateImageCost(modelId, quality);
      }
      // video_generation
      return calculateVideoCost(
        modelId,
        params?.resolution,
        params?.duration,
      );
    },
  };
}

export function createLocalCostGuard(db: Pool): CostGuard {
  return {
    async checkModelAccess() {
      // Package/tier restrictions are removed. Provider health and balance
      // checks remain enforced by the route and job executor.
    },
    checkResolution() {},
    checkVideoResolution() {},
    async checkConcurrency(workspaceId) {
      const { rows } = await db.query<{ count: number }>(
        `select count(*)::int as count from background_jobs
          where workspace_id = $1 and status in ('queued', 'running')`,
        [workspaceId],
      );
      const activeCount = rows[0]?.count ?? 0;
      if (activeCount >= DEFAULT_MAX_CONCURRENT_JOBS) {
        throw new TierGuardError(
          "concurrency_limit",
          `Concurrent job limit reached (${activeCount}/${DEFAULT_MAX_CONCURRENT_JOBS}). Please wait for a job to finish.`,
          429,
        );
      }
    },
    async calculateCreditCost(modelId, jobType, params) {
      const { rows } = await db.query<{ billing_unit: string; price_credits: number; input_token_price_cny: number | null; output_token_price_cny: number | null }>(
        "select pm.billing_unit,pm.price_credits::float8,pm.input_token_price_cny::float8,pm.output_token_price_cny::float8 from provider_models pm join provider_configs pc on pc.id=pm.provider_id where pm.model_id=$1 and pm.enabled=true and pc.enabled=true and pc.health_status='healthy' order by pm.priority,pc.latency_ms nulls last limit 1",
        [modelId],
      );
      const row = rows[0];
      if (!row) return 1;
      if (row.billing_unit === "per_million_tokens") return TOKEN_BILLING_RESERVE_CREDITS;
      if (row.billing_unit === "per_second") return Number(row.price_credits) * (params?.duration ?? 1);
      return Number(row.price_credits) * CONFIGURED_PRICE_MULTIPLIER;
    },
  };
}

/**
 * Backward-compat alias: old name was createTierGuard.
 * Code that imports `createTierGuard` still works.
 */
export const createTierGuard = createCostGuard;

/**
 * Backward-compat class alias.
 */
export class TierGuardError extends Error {
  readonly statusCode: number;
  readonly code: "model_not_accessible" | "resolution_not_allowed" | "concurrency_limit";
  constructor(
    code: "model_not_accessible" | "resolution_not_allowed" | "concurrency_limit",
    message: string,
    statusCode: number,
  ) {
    super(message);
    this.name = "TierGuardError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
