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

export function classifyErrorForClient(error: unknown): ClientError {
  const raw = error instanceof Error ? error.message : String(error);
  const messages = collectErrorMessages(error);
  const diagnosticText = messages.join("\n");
  const status = diagnosticText.match(/\b(?:provider returned|status|HTTP)\s*(\d{3})\b/i)?.[1];

  if (status === "401" || status === "403" || AUTH_PATTERN.test(diagnosticText)) {
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
  if (status === "404" || /model[_ -]?not[_ -]?found|model disabled|模型不存在|模型已停用|未开通/i.test(diagnosticText)) {
    return {
      code: "model_disabled",
      message: "当前模型已停用或未开通，请选择其他可用模型。",
      retryable: false,
    };
  }
  if (status === "429" || /rate.?limit|too many requests|限流/i.test(diagnosticText)) {
    return {
      code: "upstream_rate_limited",
      message: "AI 渠道当前限流，请稍后重试或选择其他模型。",
      retryable: true,
    };
  }
  if (/timeout|timed out|etimedout|超时/i.test(diagnosticText)) {
    return {
      code: "upstream_timeout",
      message: "AI 渠道响应超时，本次运行已停止，请稍后重试。",
      retryable: true,
    };
  }
  if (PROVIDER_PATTERN.test(diagnosticText) || INFRA_PATTERN.test(diagnosticText)) {
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
