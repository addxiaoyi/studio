import { calculateAgentTokenCharge, getAgentMessagePrice, getConfiguredBilling } from "@helstera/shared";
import type { CreditService } from "../features/credits/credit-service.js";
import type { AuthenticatedUser } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";

export type AgentMessageCharge = {
  amount: number;
  settled: boolean;
  provisional: boolean;
  transactionId: string;
  jobId: string;
  workspaceId: string;
  modelId: string;
  usageBased?: boolean;
};

export function usesHelsteraTokenBilling(modelId?: string) {
  const id = (modelId ?? "auto").replace(/^openai:/, "").trim().toLowerCase();
  return ["auto", "helsteragent", "hy4-preview-f", "hy3-x", "deepseek-v4-pro"].includes(id);
}

export function accumulateAgentTokenUsage(
  current: { inputTokens: number; outputTokens: number },
  next: { inputTokens: number; outputTokens: number },
) {
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
  };
}

export async function chargeAgentMessage(options: {
  user: AuthenticatedUser;
  modelId: string | undefined;
  viewerService: ViewerService;
  creditService: CreditService;
  runId: string;
  amount?: number;
  billOnUsage?: boolean;
}): Promise<AgentMessageCharge> {
  const viewer = await options.viewerService.ensureViewer(options.user);
  const modelId = options.modelId ?? "auto";
  const normalizedModelId = modelId.replace(/^openai:/, "").trim().toLowerCase();
  const tokenBilling = getConfiguredBilling(normalizedModelId);
  const usesUsageSettlement = usesHelsteraTokenBilling(modelId) && options.billOnUsage === true;
  const amount = options.amount ?? (usesUsageSettlement ? 0 : tokenBilling?.billingUnit === "per_million_tokens"
    ? tokenBilling.outputTokenPriceCny ?? 1
    : getAgentMessagePrice(modelId));
  const description = `HelsterAgent message (${amount.toFixed(2)} credits)`;
  const transactionId = amount === 0 ? "" : await options.creditService.deductCredits(
    viewer.workspace.id,
    options.user.id,
    amount,
    options.runId,
    description,
  );

  return {
    amount,
    transactionId,
    jobId: options.runId,
    workspaceId: viewer.workspace.id,
    modelId,
    settled: !usesUsageSettlement,
    provisional: usesUsageSettlement,
    usageBased: usesUsageSettlement,
  };
}

export async function settleAgentMessage(options: {
  user: AuthenticatedUser;
  charge: AgentMessageCharge;
  creditService: CreditService;
  inputTokens: number;
  outputTokens: number;
}): Promise<AgentMessageCharge> {
  if (!options.charge.usageBased) return options.charge;
  const targetAmount = calculateAgentTokenCharge(options.inputTokens, options.outputTokens);
  // Usage snapshots are cumulative; replay or stale snapshots must not refund prior turns.
  if (targetAmount <= options.charge.amount) return options.charge;
  if (options.charge.amount === 0) {
    const transactionId = targetAmount > 0
      ? await options.creditService.deductCredits(
          options.charge.workspaceId,
          options.user.id,
          targetAmount,
          options.charge.jobId,
          `HelsterAgent token usage (${options.inputTokens} input, ${options.outputTokens} output tokens)`,
        )
      : "";
    return { ...options.charge, amount: targetAmount, transactionId, settled: true, provisional: false };
  }
  if (targetAmount > options.charge.amount) {
    const additionalAmount = Number((targetAmount - options.charge.amount).toFixed(4));
    const transactionId = await options.creditService.deductCredits(
      options.charge.workspaceId,
      options.user.id,
      additionalAmount,
      options.charge.jobId,
      `HelsterAgent token usage adjustment (${options.inputTokens} input, ${options.outputTokens} output tokens)`,
    );
    return { ...options.charge, amount: targetAmount, transactionId, settled: true, provisional: false };
  }

  return options.charge;
}

export async function refundAgentMessage(options: {
  user: AuthenticatedUser;
  charge: AgentMessageCharge;
  creditService: CreditService;
}): Promise<void> {
  await options.creditService.refundCredits(
    options.charge.workspaceId,
    options.user.id,
    options.charge.amount,
    options.charge.jobId,
    "HelsterAgent message refund",
  );
}
