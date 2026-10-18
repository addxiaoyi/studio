export function imageRequestRejection(error: unknown): Error | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!/provider returned (400|422):/.test(message)) return null;
  if (!/安全政策|安全策略|不适合进行图像生成|content_policy_violation|safety_filter|content policy/i.test(message)) return null;
  return Object.assign(new Error("上游拒绝了本次图片请求，可能涉及内容策略或请求不适合生成图片。请检查提示词和参考图；本次不会自动重试。"), { code: "safety_filter" });
}

export function imageOutcomeUnknown(error: unknown): Error | null {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.match(/provider returned (\d{3}):/)?.[1];
  const uncertainStatus = status === "408" || (status !== undefined && Number(status) >= 500);
  const connectionLost = !status && /fetch failed|timeout|timed out|aborted|ECONNRESET|socket|no image|JSON/i.test(message);
  if (!uncertainStatus && !connectionLost) return null;
  return Object.assign(new Error(
    "图片请求已发出，但上游未返回可确认的结果。为避免重复生成或扣费，已停止自动重试；请先核对该任务的上游记录。",
    { cause: error },
  ), { code: "upstream_outcome_unknown" });
}
