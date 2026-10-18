const VIDEO_FAILOVER_CODES = new Set([
  "model_not_found",
  "video_model_unavailable",
  "no_video_model",
  "provider_unavailable",
  "provider_auth_failed",
  "provider_request_failed",
  "invalid_provider_response",
  "upstream_task_failed",
]);

const NON_RETRYABLE_CODES = new Set([
  "invalid_input",
  "model_not_found",
  "provider_auth_failed",
  "safety_filter",
  "upstream_task_accepted",
  "upstream_submit_timeout",
  "upstream_poll_timeout",
  "upstream_outcome_unknown",
]);

const ERROR_LABELS: Record<string, string> = {
  invalid_input: "The selected model does not support these inputs.",
  model_not_found: "The selected model is unavailable or retired.",
  provider_auth_failed: "The provider credentials are invalid.",
  provider_request_failed: "The provider rejected the request.",
  invalid_provider_response: "The provider returned an invalid response.",
  safety_filter: "The provider blocked this request for safety reasons.",
  timeout: "The generation timed out; it may still finish in the background.",
  upstream_task_accepted: "The provider accepted the task, but its final result is not confirmed yet.",
  upstream_submit_timeout: "The provider submission timed out; the result is unknown. Do not submit it again automatically.",
  upstream_poll_timeout: "The provider accepted the task, but polling timed out before a final result was confirmed.",
  upstream_task_failed: "The upstream generation task failed.",
  upstream_outcome_unknown: "The upstream result is unknown; do not submit the task again automatically.",
  upstream_insufficient_balance: "The provider balance is insufficient.",
};

export function shouldFailoverVideoError(code: unknown): code is string {
  return typeof code === "string" && VIDEO_FAILOVER_CODES.has(code);
}

export function canRetryGeneration(code: unknown, serverConfirmedFailure: boolean): boolean {
  if (!serverConfirmedFailure) return false;
  return typeof code !== "string" || !NON_RETRYABLE_CODES.has(code);
}

export function formatGenerationError(code: unknown, detail: string): string {
  if (typeof code !== "string") return detail;
  const label = ERROR_LABELS[code];
  return label ? `${label} ${detail}` : detail;
}
