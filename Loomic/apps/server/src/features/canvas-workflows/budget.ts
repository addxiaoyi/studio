export const MAX_WORKFLOW_BUDGET = 100000;
export function workflowBudget(value: number | undefined): number {
  const amount = value ?? 0;
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_WORKFLOW_BUDGET || Math.abs(amount * 10000 - Math.round(amount * 10000)) > 0.00001)
    throw new Error("流程预算必须是 0 至 100000 积分，最多四位小数。");
  return amount;
}

export function workflowBudgetError(cause: unknown): string | null {
  const message = cause instanceof Error ? cause.message : "";
  if (message.includes("workflow_budget_exceeded")) return "本次确认将超过整条流程的预算上限，未生成、未扣费。可取消当前流程，调整预算后重新确认运行。";
  if (message.includes("workflow_budget_missing")) return "这条流程没有有效预算记录，请重新确认运行；未生成、未扣费。";
  if (message.includes("workflow_budget_quote_changed")) return "已确认的节点费用发生变化，请重新核对方案；未追加扣费。";
  return null;
}
