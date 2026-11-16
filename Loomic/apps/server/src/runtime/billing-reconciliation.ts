import {
  calculateTokenCredits,
  getConfiguredBilling,
  type GenerationSettlement,
  generationPricingSchema,
  type GenerationPricing,
} from "@helstera/shared";
import type { ExecutorContext } from "../features/jobs/job-executor.js";
import { GenerationSettlementError, settleGenerationCredits } from "../local-db/generation-settlement.js";

export type BillingReconciliation = {
  actualCost: number;
  description: string;
  basis: GenerationSettlement["basis"];
};

export async function reconcileGenerationBilling(
  jobId: string,
  result: Record<string, unknown>,
  ctx: Pick<ExecutorContext, "jobService" | "localDb">,
  tag: string,
) {
  const job = await ctx.jobService.getJobAdmin(jobId);
  const model = typeof job.payload.model === "string" ? job.payload.model : "";
  let pricing: GenerationPricing | undefined;
  if (ctx.localDb) {
    const approval = (await ctx.localDb.query<{ billing_pricing: unknown }>(
      `select approval.billing_pricing from generation_approvals approval join background_jobs job on job.id=approval.job_id
        where approval.job_id=$1 and approval.workspace_id=$2 and approval.user_id=$3
        and approval.status='approved' and approval.consumed_at is not null
        and (job.billing_approval_id is null or approval.id=job.billing_approval_id)
        order by approval.approved_at desc nulls last,approval.created_at desc,approval.id limit 1`,
      [jobId, job.workspace_id, job.created_by],
    )).rows[0];
    if (approval) {
      const snapshot = generationPricingSchema.safeParse(approval.billing_pricing);
      if (!snapshot.success) throw new GenerationSettlementError("The approved price snapshot is missing or invalid. Review the original quote before settlement.");
      pricing = snapshot.data;
    }
  }
  if (!pricing && job.billing_pricing) pricing = generationPricingSchema.parse(job.billing_pricing);
  const reconciliation = calculateActualGenerationCredits(model, result, pricing);
  if (!reconciliation) return;
  if (!ctx.localDb) throw new GenerationSettlementError("Generation settlement requires the transactional PostgreSQL ledger.");
  const receipt = await settleGenerationCredits(ctx.localDb, jobId, reconciliation, result);
  console.log(`${tag} Generation billing reconciled for ${jobId}: reserved=${receipt.reservedCredits}, actual=${receipt.settledCredits}`);
  return receipt;
}

export class BillingReconciliationError extends Error {
  constructor(readonly code: "missing_token_usage" | "missing_provider_duration", message: string) {
    super(message);
  }
}

export function calculateActualGenerationCredits(
  model: string,
  result: Record<string, unknown>,
  frozenPricing?: GenerationPricing,
): BillingReconciliation | null {
  const billing = frozenPricing ?? getConfiguredBilling(model);
  if (!billing) return null;

  if (billing.billingUnit === "per_million_tokens") {
    const usage = result.usage as { inputTokens?: unknown; outputTokens?: unknown } | undefined;
    if (typeof usage?.inputTokens !== "number" || typeof usage.outputTokens !== "number"
      || !Number.isSafeInteger(usage.inputTokens) || !Number.isSafeInteger(usage.outputTokens)
      || usage.inputTokens < 0 || usage.outputTokens < 0) {
      throw new BillingReconciliationError(
        "missing_token_usage",
        `Token-billed model ${model} did not return token usage`,
      );
    }
    return {
      actualCost: calculateTokenCredits(
        usage.inputTokens,
        usage.outputTokens,
        billing.inputTokenPriceCny,
        billing.outputTokenPriceCny,
      ),
      description: `Helstera generation usage (${usage.inputTokens} input, ${usage.outputTokens} output tokens)`,
      basis: {
        unit: "per_million_tokens", model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        inputRate: billing.inputTokenPriceCny, outputRate: billing.outputTokenPriceCny,
      },
    };
  }

  if (billing.billingUnit !== "per_second") return null;
  if (result.duration_source === "request_fallback" || result.duration_source === "unknown") {
    throw new BillingReconciliationError(
      "missing_provider_duration",
      `Per-second model ${model} has no verified provider duration`,
    );
  }
  const duration = result.duration_seconds ?? result.durationSeconds;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    throw new BillingReconciliationError(
      "missing_provider_duration",
      `Per-second model ${model} did not return the provider duration`,
    );
  }
  const actualCost = Number((billing.creditCost * duration).toFixed(4));
  return {
    actualCost,
    description: `Video provider usage (${duration}s at ${billing.creditCost} credits/s)`,
    basis: { unit: "per_second", model, seconds: duration, creditsPerSecond: billing.creditCost },
  };
}
