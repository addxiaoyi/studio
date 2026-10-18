import { getAgentMessagePrice, getConfiguredBilling } from "@helstera/shared";
import type { CreditService } from "../features/credits/credit-service.js";
import type { AuthenticatedUser } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";

export type AgentMessageCharge = {
  amount: number;
  transactionId: string;
  jobId: string;
  workspaceId: string;
  modelId: string;
};

export async function chargeAgentMessage(options: {
  user: AuthenticatedUser;
  modelId: string | undefined;
  viewerService: ViewerService;
  creditService: CreditService;
  runId: string;
}): Promise<AgentMessageCharge> {
  const viewer = await options.viewerService.ensureViewer(options.user);
  const modelId = options.modelId ?? "auto";
  const normalizedModelId = modelId.replace(/^openai:/, "").trim().toLowerCase();
  const tokenBilling = getConfiguredBilling(normalizedModelId);
  const amount = tokenBilling?.billingUnit === "per_million_tokens"
    ? 1
    : getAgentMessagePrice(modelId);
  const description = `�Ի���Ϣ �� ${modelId} �� ʵ�ʹ���Ԥ�ۿ���${amount.toFixed(2)} ������ɺ󽫸��ݱ���ʹ������`;
  const transactionId = await options.creditService.deductCredits(
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
  };
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
    `对话消息失败退款 · ${options.charge.modelId}`,
  );
}
