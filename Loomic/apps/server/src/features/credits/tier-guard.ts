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
} from "@helstera/shared";

import type { AdminSupabaseClient } from "../../supabase/admin.js";

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
  checkModelAccess(modelId: string): void;
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
  ): number;
};

// ── Factory ──────────────────────────────────────────────────

export function createCostGuard(options: {
  getAdminClient: () => AdminSupabaseClient;
}): CostGuard {
  return {
    checkModelAccess() {
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

    calculateCreditCost(modelId, jobType, params) {
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
