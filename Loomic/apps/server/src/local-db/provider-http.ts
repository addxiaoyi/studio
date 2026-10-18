export type ProviderRequestOptions = {
  timeoutMs: number;
  operation: string;
  requestId?: string;
  phase?: "submit" | "poll";
};
const MAX_PROVIDER_RESPONSE_BYTES = 32 * 1024 * 1024;

export class ProviderRequestTimeoutError extends Error {
  readonly code: "upstream_submit_timeout" | "upstream_poll_timeout" | "upstream_outcome_unknown";

  constructor(options: ProviderRequestOptions) {
    const phase = options.phase ?? "submit";
    const requestId = options.requestId ? ` requestId=${options.requestId}` : "";
    super(`${options.operation} ${phase} request timed out after ${options.timeoutMs}ms.${requestId}`);
    this.name = "ProviderRequestTimeoutError";
    this.code = options.operation === "video"
      ? phase === "poll" ? "upstream_poll_timeout" : "upstream_submit_timeout"
      : "upstream_outcome_unknown";
  }
}

export class ProviderHttpError extends Error {
  readonly code: "invalid_input" | "provider_auth_failed" | "upstream_insufficient_balance" | "model_not_found" | "upstream_rate_limited" | "provider_request_failed";
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ProviderHttpError";
    this.code = providerHttpErrorCode(status);
  }
}

function providerHttpErrorCode(status: number): ProviderHttpError["code"] {
  if (status === 400 || status === 422) return "invalid_input";
  if (status === 401 || status === 403) return "provider_auth_failed";
  if (status === 402) return "upstream_insufficient_balance";
  if (status === 404) return "model_not_found";
  if (status === 429) return "upstream_rate_limited";
  return "provider_request_failed";
}

export async function requestProviderJson(url: string, init: RequestInit, options: ProviderRequestOptions): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (options.requestId) headers.set("x-helstera-request-id", options.requestId);
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(options.timeoutMs) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/abort|timeout|timed out/i.test(message)) {
      throw new ProviderRequestTimeoutError(options);
    }
    throw error;
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new ProviderHttpError(502, `${options.operation} provider response exceeded ${MAX_PROVIDER_RESPONSE_BYTES} bytes`);
  }
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new ProviderHttpError(502, `${options.operation} provider response exceeded ${MAX_PROVIDER_RESPONSE_BYTES} bytes`);
  }
  let body: unknown = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  if (!response.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new ProviderHttpError(response.status, `${options.operation} provider returned ${response.status}: ${detail.slice(0, 500)}`);
  }
  return body;
}
