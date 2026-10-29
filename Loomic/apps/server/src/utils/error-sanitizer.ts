/**
 * Sanitize error messages before sending to the frontend.
 * Logs full error detail server-side, returns user-friendly message.
 */

const PROVIDER_PATTERN =
  /google|vertex|openai|replicate|langchain|gaxios|undici|fetch failed/i;
const DB_PATTERN =
  /supabase|postgres|pgmq|database|relation|column|constraint/i;
const AUTH_PATTERN =
  /jwt|token|unauthorized|forbidden|credential|service.account/i;
const INFRA_PATTERN =
  /econnrefused|econnreset|etimedout|dns|socket|tls|certificate/i;

/**
 * 上游“瞬时不可用”的文本特征。
 * 只作为回退依据：一旦拿到显式 HTTP 状态码，就以状态码为准（见 classifyErrorForClient）。
 */
const TRANSIENT_UPSTREAM_PATTERN =
  /service temporarily unavailable|temporarily unavailable|temporarily overloaded|overloaded|bad gateway|gateway time(?:d)? ?out|service unavailable|upstream connect error|no healthy upstream|premature close|socket hang up|connection reset|connection refused|econnreset|econnrefused|etimedout|服务暂不可用|上游服务不可用/i;

/**
 * 用户输入 / 请求本身不合法：重试不会变好，必须判为不可重试。
 * 该判定优先于任何“看起来像上游故障”的文本特征。
 */
const USER_INPUT_PATTERN =
  /invalid[_ -]?(?:input|request|argument|parameter|value)|unsupported|validation|prompt (?:is )?too long|context[ _]length|参数(?:错误|不合法|不支持)|不支持|内容过长/i;

/** 仅这些类别值得让调用方自动重试；其余错误重试只会放大损失。 */
const RETRYABLE_UPSTREAM_CODES: ReadonlySet<ClientError["code"]> = new Set([
  "provider_unavailable",
  "upstream_rate_limited",
]);

export type ClientError = {
  code:
    | "model_disabled"
    | "model_selection_required"
    | "provider_auth_failed"
    | "provider_unavailable"
    | "run_failed"
    | "upstream_rate_limited"
    | "upstream_timeout";
  message: string;
  retryable: boolean;
};

/**
 * 判定优先级（高 → 低）：
 *   1. 结构化字段里的显式 HTTP 状态码（error.status / statusCode / response.status，含 cause 链与 AggregateError）
 *   2. 错误文本里的显式状态码（HTTP 503 / status: 429 / provider returned 500 / 独立的 429·502·503·504）
 *   3. 文本特征（瞬时不可用、用户输入不合法、认证、模型不存在、限流、超时……）
 * 只有 1、2 全程未命中时才走 3，避免把“用户输入错误”或“认证失败”误判成可重试的上游故障。
 */
export function classifyErrorForClient(error: unknown): ClientError {
  const messages = collectErrorMessages(error);
  const diagnosticText = messages.join("\n");

  const explicitStatus = extractExplicitStatus(error) ?? extractTextStatus(diagnosticText);
  if (explicitStatus !== undefined) {
    const byStatus = classifyByStatus(explicitStatus);
    if (byStatus) return byStatus;
  }

  if (AUTH_PATTERN.test(diagnosticText)) {
    return {
      code: "provider_auth_failed",
      message: "当前 AI 渠道认证失败，请切换模型或联系管理员检查渠道配置。",
      retryable: false,
    };
  }
  const selectionMessage = messages.find((message) => /MODEL_SELECTION_REQUIRED:/i.test(message));
  if (selectionMessage) {
    return {
      code: "model_selection_required",
      message: selectionMessage.replace(/^MODEL_SELECTION_REQUIRED:\s*/i, "").trim() || "你已手动选择模型，本次未擅自切换模型。",
      retryable: false,
    };
  }
  if (/model[_ -]?not[_ -]?found|model disabled|模型不存在|模型已停用|未开通/i.test(diagnosticText)) {
    return {
      code: "model_disabled",
      message: "当前模型已停用或未开通，请选择其他可用模型。",
      retryable: false,
    };
  }
  if (/rate.?limit|too many requests|限流/i.test(diagnosticText)) {
    return {
      code: "upstream_rate_limited",
      message: "AI 渠道当前限流，请稍后重试或选择其他模型。",
      retryable: true,
    };
  }
  if (/timeout|timed out|超时/i.test(diagnosticText)) {
    return {
      code: "upstream_timeout",
      message: "AI 渠道响应超时，本次运行已停止，请稍后重试。",
      retryable: true,
    };
  }
  // 用户输入不合法优先于“上游不可用”的泛化文本特征：这类错误重试无用。
  if (USER_INPUT_PATTERN.test(diagnosticText)) {
    return {
      code: "run_failed",
      message: sanitizeErrorForClient(error),
      retryable: false,
    };
  }
  if (
    TRANSIENT_UPSTREAM_PATTERN.test(diagnosticText) ||
    PROVIDER_PATTERN.test(diagnosticText) ||
    INFRA_PATTERN.test(diagnosticText)
  ) {
    return {
      code: "provider_unavailable",
      message: "AI 服务当前不可用，本次运行已停止。请切换模型或稍后重试。",
      retryable: true,
    };
  }
  return {
    code: "run_failed",
    message: sanitizeErrorForClient(error),
    retryable: true,
  };
}

/** 按显式 HTTP 状态码归类；返回 undefined 表示该状态码不足以定性。 */
function classifyByStatus(status: number): ClientError | undefined {
  if (status === 401 || status === 403) {
    return {
      code: "provider_auth_failed",
      message: "当前 AI 渠道认证失败，请切换模型或联系管理员检查渠道配置。",
      retryable: false,
    };
  }
  if (status === 402) {
    return {
      code: "run_failed",
      message: "当前 AI 渠道额度不足，请切换渠道或补充额度。",
      retryable: false,
    };
  }
  if (status === 404) {
    return {
      code: "model_disabled",
      message: "当前模型已停用或未开通，请选择其他可用模型。",
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      code: "upstream_rate_limited",
      message: "AI 渠道当前限流，请稍后重试或选择其他模型。",
      retryable: true,
    };
  }
  if (status === 408) {
    return {
      code: "upstream_timeout",
      message: "AI 渠道响应超时，本次运行已停止，请稍后重试。",
      retryable: true,
    };
  }
  // 502/503/504 及所有 5xx：供应商暂时不可用，属于可重试的瞬时故障。
  if (status >= 500 && status <= 599) {
    return {
      code: "provider_unavailable",
      message: "AI 服务当前不可用，本次运行已停止。请切换模型或稍后重试。",
      retryable: true,
    };
  }
  // 其余 4xx：请求本身有问题，重试不会变好。
  if (status >= 400 && status <= 499) {
    return {
      code: "run_failed",
      message: "请求被上游拒绝，请检查输入后重试。",
      retryable: false,
    };
  }
  return undefined;
}

/** 从结构化字段里取显式状态码（外层优先），遍历 cause 链与 AggregateError。 */
function extractExplicitStatus(error: unknown): number | undefined {
  const visited = new Set<object>();
  const queue: unknown[] = [error];
  while (queue.length > 0) {
    const value = queue.shift();
    if (value == null) continue;
    if (typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    const record = value as Record<string, unknown>;
    if (value instanceof AggregateError) queue.push(...(value.errors as unknown[]));
    const response = (record.response ?? undefined) as Record<string, unknown> | undefined;
    const candidates: unknown[] = [
      record.status,
      record.statusCode,
      response?.status,
      response?.statusCode,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "number" && candidate >= 100 && candidate <= 599) return candidate;
      if (typeof candidate === "string" && /^[1-5]\d{2}$/.test(candidate)) return Number(candidate);
    }
    if (record.cause) queue.push(record.cause);
  }
  return undefined;
}

/**
 * 文本里的状态码：先找带标签的（HTTP 503 / status: 429 / provider returned 500），
 * 再接受独立出现的著名瞬时状态码（429/502/503/504），避免把 "1803 tokens" 这类数字误判成状态码。
 */
function extractTextStatus(text: string): number | undefined {
  const labelled = text.match(/\b(?:http(?:\/\d(?:\.\d)?)?|status(?: ?code)?|provider returned|error code)\b\s*[:=]?\s*(\d{3})\b/i);
  if (labelled?.[1]) return Number(labelled[1]);
  const bare = text.match(/(?:^|[^\d.])(429|502|503|504)(?![\d.])/);
  if (bare?.[1]) return Number(bare[1]);
  return undefined;
}

/**
 * 错误是否属于“上游瞬时故障”且值得自动重试。
 * 认证失败、模型不存在、用户输入错误、额度不足一律返回 false。
 */
export function isRetryableUpstreamError(error: unknown): boolean {
  const classified = classifyErrorForClient(error);
  return classified.retryable && RETRYABLE_UPSTREAM_CODES.has(classified.code);
}

function collectErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  const visited = new Set<object>();
  const visit = (value: unknown): void => {
    if (value == null) return;
    if (typeof value === "string") {
      messages.push(value);
      return;
    }
    if (typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (value instanceof AggregateError) value.errors.forEach(visit);
    const wrapped = value as { message?: unknown; cause?: unknown };
    if (typeof wrapped.message === "string") messages.push(wrapped.message);
    visit(wrapped.cause);
  };
  visit(error);
  return messages.length ? messages : [String(error)];
}

export function sanitizeErrorForClient(error: unknown): string {
  if (error instanceof Error && "code" in error && error.code === "upstream_outcome_unknown") {
    return "图片请求已发出，但上游结果尚无法确认。为避免重复扣费，未自动重试；请核对任务记录后再操作。";
  }
  if (error instanceof Error && "code" in error && error.code === "safety_filter") {
    return "上游拒绝了本次生成请求，可能涉及内容策略或请求不适合生成。请检查提示词和参考图；本次不会自动重试。";
  }
  const raw = error instanceof Error ? error.message : String(error);
  const status = raw.match(/\b(?:provider returned|status|HTTP)\s*(\d{3})\b/i)?.[1];

  // Provider errors can contain bearer tokens, signed URLs, or image data.
  // Keep diagnostics useful without turning error logging into data exfiltration.
  console.error("[error-sanitizer] Raw error:", redactDiagnostic(raw));
  if (error instanceof Error) {
    // Log nested cause chain (LangChain wraps errors multiple levels deep)
    let cause = (error as any).cause;
    while (cause) {
      console.error("[error-sanitizer] Caused by:", redactDiagnostic(String(cause.message ?? cause)));
      cause = cause.cause;
    }
    // Log response details if present (Google API errors attach response/details)
    const errAny = error as any;
    if (errAny.response) {
      console.error("[error-sanitizer] Response status:", errAny.response.status);
      console.error("[error-sanitizer] Response data:", redactDiagnostic(JSON.stringify(errAny.response.data ?? errAny.response.body ?? "")).substring(0, 2000));
    }
    if (errAny.details) {
      console.error("[error-sanitizer] Details:", redactDiagnostic(JSON.stringify(errAny.details)).substring(0, 2000));
    }
    if (error.stack) {
      console.error("[error-sanitizer] Stack:", error.stack);
    }
  }

  // Keep provider failures actionable without exposing response bodies.
  if (status === "401" || status === "403" || AUTH_PATTERN.test(raw)) {
    return "图片渠道认证失败，请检查渠道密钥或联系管理员。";
  }
  if (status === "402" || /insufficient|余额|quota|credit|billing/i.test(raw)) {
    return "图片渠道额度不足，请切换可用渠道或补充额度。";
  }
  if (status === "404" || /model[_ -]?not[_ -]?found|模型不存在|未开通/i.test(raw)) {
    return "当前图片模型未开通或不存在，请选择其他可用模型。";
  }
  if (status === "400" || status === "422" || /invalid[_ -]?input|invalid[_ -]?request|参数|unsupported/i.test(raw)) {
    return "当前图片模型不支持本次参数或参考图，请调整参数或选择其他模型。";
  }
  if (status === "429" || /rate.?limit|too many requests|限流/i.test(raw)) {
    return "图片渠道当前限流，请稍后重试或选择其他模型。";
  }
  if (PROVIDER_PATTERN.test(raw)) {
    return "AI 服务暂时不可用，请稍后重试。";
  }
  if (DB_PATTERN.test(raw)) {
    return "数据服务异常，请稍后重试。";
  }
  if (AUTH_PATTERN.test(raw)) {
    return "认证失败，请刷新页面重新登录。";
  }
  if (INFRA_PATTERN.test(raw)) {
    return "网络连接异常，请检查网络后重试。";
  }
  if (raw.includes("abort") || raw.includes("cancel")) {
    return "请求已取消。";
  }
  if (raw.length > 100) {
    // Long messages are likely stack traces or JSON errors
    return "请求处理失败，请重试。";
  }

  // Short, non-technical messages can pass through
  return "请求处理失败，请重试。";
}

function redactDiagnostic(value: string): string {
  return value
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*([^,\s}]+)/gi, "$1=[REDACTED]")
    .replace(/data:[^;,]+;base64,[a-z0-9+/=]+/gi, "data:[REDACTED]")
    .replace(/([?&](?:key|token|signature|sig)=)[^&\s]+/gi, "$1[REDACTED]");
}
