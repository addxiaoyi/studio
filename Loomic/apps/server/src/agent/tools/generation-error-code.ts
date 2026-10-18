export type GenerationToolErrorCode =
  | "model_selection_required"
  | "model_not_found"
  | "invalid_input"
  | "provider_not_found"
  | "provider_auth_failed"
  | "provider_request_failed"
  | "invalid_provider_response"
  | "safety_filter"
  | "timeout"
  | "upstream_task_accepted"
  | "upstream_submit_timeout"
  | "upstream_poll_timeout"
  | "upstream_task_failed"
  | "upstream_outcome_unknown"
  | "upstream_insufficient_balance";

const KNOWN_CODES = new Set<GenerationToolErrorCode>([
  "model_selection_required",
  "model_not_found",
  "invalid_input",
  "provider_not_found",
  "provider_auth_failed",
  "provider_request_failed",
  "invalid_provider_response",
  "safety_filter",
  "timeout",
  "upstream_task_accepted",
  "upstream_submit_timeout",
  "upstream_poll_timeout",
  "upstream_task_failed",
  "upstream_outcome_unknown",
  "upstream_insufficient_balance",
]);

export function readGenerationToolErrorCode(error: unknown): GenerationToolErrorCode | undefined {
  return readCode(error, new Set<object>());
}

function readCode(error: unknown, seen: Set<object>): GenerationToolErrorCode | undefined {
  if (!error || typeof error !== "object") return undefined;
  if (seen.has(error)) return undefined;
  seen.add(error);

  const record = error as Record<string, unknown>;
  const directCode = record.code;
  if (typeof directCode === "string" && KNOWN_CODES.has(directCode as GenerationToolErrorCode)) {
    return directCode as GenerationToolErrorCode;
  }

  const causeCode = readCode(record.cause, seen);
  if (causeCode) return causeCode;

  if (Array.isArray(record.errors)) {
    for (const nested of record.errors) {
      const nestedCode = readCode(nested, seen);
      if (nestedCode) return nestedCode;
    }
  }
  return undefined;
}
