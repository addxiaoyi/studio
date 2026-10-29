// @api-error-message — 底层异常 → 结构化、可本地化的用户文案
//
// 为什么单独一个模块：`server-api.ts` 里拿到的底层异常有三类原始形态——
//   1. fetch 断网时抛的 `TypeError: Failed to fetch`（英文，浏览器给的）；
//   2. 超时被 abort 后抛的 `DOMException: The operation was aborted`（英文）；
//   3. 服务端 5xx / 无 body 时兜底的 `"Request failed"`（英文）。
// 这三种都会原样钻进调用方的 `error.message`，最终出现在中文界面上。
//
// 本模块只做两件事：把异常归成有限的 `ApiErrorKind`，把类别映射成
// “发生了什么 + 可以做什么”的双语模板。刻意不依赖 `i18n.ts`（那边会拉进
// react 与 localStorage），也刻意不 import `server-api.ts`（避免循环依赖）：
// 分类靠 `kind` 字段与 `name` 的鸭子类型判断。

export type ApiErrorLocale = "zh-CN" | "en-US";

/**
 * 用户可感知的错误类别。前五个是明确可分类的，`unknown` 是不敢乱猜时的兜底。
 * 注意 `unauthorized` 与 `business` 的区别：前者由 HTTP 401 决定（登录态问题，
 * 处理手段是重新登录），后者由服务端业务码决定（处理手段是按提示改操作）。
 */
export type ApiErrorKind =
  | "network"
  | "timeout"
  | "server"
  | "unauthorized"
  | "business"
  | "unknown";

export type ApiErrorCopy = {
  /** 发生了什么 */
  title: string;
  /** 可以做什么 */
  action: string;
};

const COPY: Record<ApiErrorLocale, Record<ApiErrorKind, ApiErrorCopy>> = {
  "zh-CN": {
    network: {
      title: "网络连不上服务器，这次请求没有发出去",
      action:
        "请检查网络连接或代理设置后重试；网络已恢复仍失败时，稍后重试或联系管理员确认服务是否可用",
    },
    timeout: {
      title: "服务器超过 30 秒没有响应，这次请求已超时",
      action: "请稍后重试；上传参考图或视频时可以先压缩到更小体积再提交",
    },
    server: {
      title: "服务器处理这次请求时出错了，操作没有完成",
      action: "请稍后重试；如果反复失败，请把出错时间和操作步骤告诉管理员",
    },
    unauthorized: {
      title: "登录状态已失效",
      action: "请重新登录后再继续刚才的操作",
    },
    business: {
      title: "这次操作没有完成",
      action: "请按提示调整后重试；如果仍然失败，请联系管理员并提供操作时间",
    },
    unknown: {
      title: "出现了未知问题，这次操作没有完成",
      action: "请稍后重试；如果一直出现，请把出错时间和操作步骤告诉管理员",
    },
  },
  "en-US": {
    network: {
      title: "Cannot reach the server, so this request was never sent",
      action:
        "Check your network or proxy settings and try again; if the network is fine, retry later or ask an administrator whether the service is up",
    },
    timeout: {
      title: "The server did not respond within 30 seconds, so this request timed out",
      action:
        "Try again shortly; for large reference images or videos, compress them before uploading",
    },
    server: {
      title: "The server failed while handling this request, so nothing was saved",
      action:
        "Try again shortly; if it keeps failing, give an administrator the time and the steps you took",
    },
    unauthorized: {
      title: "Your sign-in has expired",
      action: "Sign in again, then repeat what you were doing",
    },
    business: {
      title: "This action did not complete",
      action:
        "Adjust what the message suggests and try again; if it still fails, contact an administrator with the time it happened",
    },
    unknown: {
      title: "Something unexpected went wrong, so this action did not complete",
      action:
        "Try again shortly; if it keeps happening, give an administrator the time and the steps you took",
    },
  },
};

/** 服务端偶尔只给这些英文兜底串。它们不含信息量，必须换成本地化文案。 */
const PLACEHOLDER_SERVER_MESSAGES = new Set(
  [
    "request failed",
    "request failed.",
    "failed to fetch",
    "the operation was aborted",
    "internal server error",
    "application_error",
    "server error",
    "error",
    "unknown error",
    "unauthorized",
    "bad gateway",
    "service unavailable",
  ].map((value) => value.toLowerCase()),
);

/**
 * 界面语言来源，顺序与 `i18n.ts` 的 `detectLocale()` 一致：
 *   显式 override > 用户选过的语言（localStorage）> `<html lang>` 声明 > zh-CN。
 *
 * 不跟随 `navigator.language`：那是系统语言，会把中文产品的英文浏览器用户
 * 切成英文界面（`i18n.ts` / `desktop-copy.ts` 也是同一个取舍）。
 *
 * 存储键在这里复制了一份而不是 import `i18n.ts`：那边会拉进 react 与 hooks，
 * 而本模块要能在任何上下文里跑。两边一致性由测试锁死（`api-error-message.test.ts`）。
 */
export const API_ERROR_LOCALE_STORAGE_KEY = "helstera.locale";

let overrideLocale: ApiErrorLocale | null = null;

/**
 * 供将来把语言选择接进来（组件仍不在本次写入范围）。传 null 恢复自动探测。
 */
export function setApiErrorLocale(locale: ApiErrorLocale | null): void {
  overrideLocale = locale;
}

function readStoredLocale(): ApiErrorLocale | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage?.getItem(API_ERROR_LOCALE_STORAGE_KEY);
    return stored === "en-US" || stored === "zh-CN" ? stored : null;
  } catch {
    // 隐私模式 / 配额满：读不到就当没选过。
    return null;
  }
}

export function resolveApiErrorLocale(): ApiErrorLocale {
  if (overrideLocale) return overrideLocale;
  const stored = readStoredLocale();
  if (stored) return stored;
  if (typeof document === "undefined") return "zh-CN";
  const declared = document.documentElement?.lang ?? "";
  return declared.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[。.!！?？;；,，\s]+$/u, "");
}

/** 把 title/action 拼成一句话，中文用全角标点，英文用半角。 */
export function formatApiErrorCopy(
  copy: ApiErrorCopy,
  locale: ApiErrorLocale = resolveApiErrorLocale(),
): string {
  const title = stripTrailingPunctuation(copy.title);
  const action = stripTrailingPunctuation(copy.action);
  return locale === "en-US" ? `${title}. ${action}.` : `${title}。${action}。`;
}

export function apiErrorCopy(
  kind: ApiErrorKind,
  locale: ApiErrorLocale = resolveApiErrorLocale(),
): ApiErrorCopy {
  return COPY[locale][kind];
}

/** 类别 → 完整文案。`detail` 只对 business 有意义（服务端自己写的中文提示）。 */
export function localizedApiErrorMessage(
  kind: ApiErrorKind,
  locale: ApiErrorLocale = resolveApiErrorLocale(),
  detail?: string | null,
): string {
  const trimmed = typeof detail === "string" ? detail.trim() : "";
  if (kind === "business" && isInformativeServerMessage(trimmed)) {
    return trimmed;
  }
  return formatApiErrorCopy(COPY[locale][kind], locale);
}

export function isInformativeServerMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return !PLACEHOLDER_SERVER_MESSAGES.has(trimmed.toLowerCase());
}

function readKind(error: unknown): ApiErrorKind | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = (error as { kind?: unknown }).kind;
  if (typeof candidate !== "string") return null;
  return candidate in COPY["zh-CN"] ? (candidate as ApiErrorKind) : null;
}

function readName(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

function readStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  for (const key of ["statusCode", "status"] as const) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * 只做分类，不做文案。给调用方做分支用（比如决定是否跳登录页）。
 *
 * 命中顺序刻意按“确定性从高到低”：先看我们自己打的 `kind`，再看异常 `name`
 * （`AbortError` = 超时，`TypeError` = fetch 底层失败，即网络不可达），最后才
 * 看 status。注意调用方主动取消（`callerSignal.aborted`）不该被归成超时，
 * 那一步在 `server-api.ts` 里提前返回，这里不承担。
 */
export function classifyApiError(error: unknown): ApiErrorKind {
  const explicit = readKind(error);
  if (explicit) return explicit;

  const name = readName(error);
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  if (name === "TypeError") return "network";

  const status = readStatus(error);
  if (status !== null) {
    if (status === 401 || status === 403) return "unauthorized";
    if (status >= 500) return "server";
  }

  if (name === "ApiAuthError") return "unauthorized";
  if (name === "ApiApplicationError") return "business";
  return "unknown";
}

/**
 * 给 URL / 状态码这类“可以自己描述清楚”的场合用的分类器：
 * 不碰原始 message，永远返回本地化文案。
 */
export function toUserMessage(
  error: unknown,
  locale: ApiErrorLocale = resolveApiErrorLocale(),
): string {
  const kind = classifyApiError(error);
  const detail =
    typeof error === "object" && error !== null
      ? (error as { serverMessage?: unknown }).serverMessage
      : undefined;
  return localizedApiErrorMessage(
    kind,
    locale,
    typeof detail === "string" ? detail : null,
  );
}
