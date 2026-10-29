// @vitest-environment jsdom
//
// P0：断网/超时会把浏览器原始英文（Failed to fetch / The operation was aborted）
// 直接显示在中文界面。这些用例逐条反证：“分类对了、文案是给用户看的、
// 原始英文不出现在 message 里、原始异常仍在 cause 里”。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  API_ERROR_LOCALE_STORAGE_KEY,
  classifyApiError,
  localizedApiErrorMessage,
  resolveApiErrorLocale,
  setApiErrorLocale,
  toUserMessage,
} from "../src/lib/api-error-message";
import { LOCALE_STORAGE_KEY } from "../src/lib/i18n";
import {
  ApiApplicationError,
  ApiAuthError,
  ApiNetworkError,
  ApiServerError,
  ApiTimeoutError,
  createProject,
  fetchJob,
  fetchModels,
  fetchViewer,
} from "../src/lib/server-api";

const RAW_NETWORK = "Failed to fetch";
const RAW_ABORT = "The operation was aborted";
const RAW_500_FALLBACK = "Request failed";

/** 中文文案一律不允许出现这些浏览器原始英文片段。 */
const RAW_FRAGMENTS = [RAW_NETWORK, RAW_ABORT, RAW_500_FALLBACK, "TypeError"];

function expectNoRawEnglish(message: string) {
  for (const fragment of RAW_FRAGMENTS) {
    expect(message).not.toContain(fragment);
  }
}

function abortedError(): DOMException {
  return new DOMException(RAW_ABORT, "AbortError");
}

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// jsdom 没有 origin 就没有 localStorage；和 i18n-locale 测试一样手动 stub，
// 这样才能验证“用户选过英文语言时错误文案也跟着切”。
const storageValues = new Map<string, string>();
const storage = {
  getItem: (key: string) => storageValues.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storageValues.set(key, value);
  },
  removeItem: (key: string) => {
    storageValues.delete(key);
  },
  clear: () => storageValues.clear(),
};

beforeEach(() => {
  vi.clearAllMocks();
  setApiErrorLocale(null);
  document.documentElement.lang = "";
  storageValues.clear();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://localhost:3001");
});

afterEach(() => {
  setApiErrorLocale(null);
  document.documentElement.lang = "";
  storageValues.clear();
});

describe("error classification", () => {
  it("treats TypeError from fetch as an unreachable network", () => {
    const error = new TypeError(RAW_NETWORK);

    expect(classifyApiError(error)).toBe("network");
    const zh = toUserMessage(error, "zh-CN");
    expect(zh).toContain("网络");
    expect(zh).toContain("请检查网络连接或代理设置后重试");
    expectNoRawEnglish(zh);

    const en = toUserMessage(error, "en-US");
    expect(en).toContain("Cannot reach the server");
    expect(en).toContain("Check your network or proxy settings");
    expect(en).not.toContain(RAW_NETWORK);
  });

  it("treats AbortError as a timeout, not as an English abort message", () => {
    const error = abortedError();

    expect(classifyApiError(error)).toBe("timeout");
    const zh = toUserMessage(error, "zh-CN");
    expect(zh).toContain("30 秒");
    expect(zh).toContain("超时");
    expect(zh).toContain("请稍后重试");
    expectNoRawEnglish(zh);

    const en = toUserMessage(error, "en-US");
    expect(en).toContain("timed out");
    expect(en).not.toContain(RAW_ABORT);
  });

  it("treats 5xx as a server error with an actionable suggestion", () => {
    const error = new ApiServerError(503, "model_list_failed");

    expect(classifyApiError(error)).toBe("server");
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe("model_list_failed");
    expect(error.message).toContain("服务器处理这次请求时出错了");
    // “可以做什么”必须落在文案里，而不是只说“出错了”。
    expect(error.message).toContain("请稍后重试");
    expect(error.message).toContain("管理员");
    expectNoRawEnglish(error.message);

    expect(toUserMessage(error, "en-US")).toContain("Try again shortly");
  });

  it("maps 401 to an expired sign-in that tells the user to sign in again", () => {
    const error = new ApiAuthError();

    expect(classifyApiError(error)).toBe("unauthorized");
    expect(error.kind).toBe("unauthorized");
    expect(error.message).toContain("登录状态已失效");
    expect(error.message).toContain("请重新登录");
    expect(error.message).not.toContain("unauthorized");

    expect(toUserMessage(error, "en-US")).toContain("Sign in again");
  });

  it("keeps the business code and lets human-written server copy through", () => {
    const serverCopy = "项目链接已被占用，请换一个名称后重试。";
    const error = new ApiApplicationError("project_slug_taken", serverCopy);

    expect(classifyApiError(error)).toBe("business");
    expect(error.code).toBe("project_slug_taken");
    expect(error.message).toBe(serverCopy);
    expectNoRawEnglish(error.message);
  });

  it("replaces an empty/placeholder server message with localized business copy", () => {
    // 服务端没给 body 时旧实现会兜底成 "Request failed"（英文），必须换掉。
    for (const placeholder of ["", "   ", RAW_500_FALLBACK, "Internal Server Error"]) {
      const message = localizedApiErrorMessage("business", "zh-CN", placeholder);
      expect(message).toContain("这次操作没有完成");
      expect(message).toContain("请按提示调整后重试");
      expectNoRawEnglish(message);
    }

    const english = localizedApiErrorMessage("business", "en-US", RAW_500_FALLBACK);
    expect(english).toContain("This action did not complete");
    expect(english).toContain("Adjust what the message suggests");
    expect(english).not.toContain(RAW_500_FALLBACK);
  });

  it("falls back to a localized unknown copy instead of the raw message", () => {
    const error = new Error("boom: internal detail leak");

    expect(classifyApiError(error)).toBe("unknown");
    const zh = toUserMessage(error, "zh-CN");
    expect(zh).toContain("未知问题");
    expect(zh).toContain("请稍后重试");
    expect(zh).not.toContain("boom");
  });

  it("follows the declared document language and defaults to zh-CN", () => {
    expect(resolveApiErrorLocale()).toBe("zh-CN");
    document.documentElement.lang = "en-US";
    expect(resolveApiErrorLocale()).toBe("en-US");
    setApiErrorLocale("zh-CN");
    expect(resolveApiErrorLocale()).toBe("zh-CN");
  });

  it("reads the language the user already picked in i18n (same storage key)", () => {
    // 存储键是复制过来的，这里锁死它与 i18n.ts 的一致性。
    expect(API_ERROR_LOCALE_STORAGE_KEY).toBe(LOCALE_STORAGE_KEY);

    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en-US");
    expect(resolveApiErrorLocale()).toBe("en-US");

    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    expect(resolveApiErrorLocale()).toBe("zh-CN");

    // 用户没选过时回落到 <html lang>。
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    document.documentElement.lang = "en-US";
    expect(resolveApiErrorLocale()).toBe("en-US");  });
});

describe("server-api transport errors", () => {
  it("turns a dropped connection into ApiNetworkError with Chinese copy and a cause", async () => {
    const raw = new TypeError(RAW_NETWORK);
    mockFetch.mockRejectedValue(raw);

    const caught = await fetchModels().catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ApiNetworkError);
    const error = caught as ApiNetworkError;
    expect(error.kind).toBe("network");
    expect(error.message).toContain("网络连不上服务器");
    expect(error.message).toContain("请检查网络连接或代理设置后重试");
    expectNoRawEnglish(error.message);
    // 原始异常必须保留，但 UI 不该读它。
    expect(error.cause).toBe(raw);
  });

  it("turns a browser abort into ApiTimeoutError with Chinese copy", async () => {
    const raw = abortedError();
    mockFetch.mockRejectedValue(raw);

    const caught = await fetchModels().catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ApiTimeoutError);
    const error = caught as ApiTimeoutError;
    expect(error.kind).toBe("timeout");
    expect(error.message).toContain("已超时");
    expect(error.message).toContain("请稍后重试");
    expect(error.message).not.toContain(RAW_ABORT);
    expect(error.cause).toBe(raw);
  });

  it("does not disguise a caller cancel as a timeout", async () => {
    const controller = new AbortController();
    controller.abort();
    mockFetch.mockRejectedValue(abortedError());

    const caught = await fetchJob("token_abc", "job_1", controller.signal).catch(
      (error: unknown) => error,
    );

    expect(caught).not.toBeInstanceOf(ApiTimeoutError);
    expect((caught as Error).name).toBe("AbortError");
  });

  it("turns a 500 into ApiServerError with an actionable message", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        error: { code: "project_create_failed", message: RAW_500_FALLBACK },
      }),
    });

    const caught = await fetchViewer("token_abc").catch(
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(ApiServerError);
    const error = caught as ApiServerError;
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe("project_create_failed");
    expect(error.message).toContain("服务器处理这次请求时出错了");
    expect(error.message).toContain("如果反复失败");
    expectNoRawEnglish(error.message);
  });

  it("turns a 401 into ApiAuthError with a re-sign-in message", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: { code: "unauthorized", message: "Bad token." },
      }),
    });

    const caught = await fetchViewer("expired").catch(
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(ApiAuthError);
    const error = caught as ApiAuthError;
    expect(error.kind).toBe("unauthorized");
    expect(error.message).toContain("登录状态已失效");
    expect(error.message).toContain("请重新登录");
    expect(error.message).not.toContain("unauthorized");
    expect(error.message).not.toContain("Bad token");
  });

  it("keeps a 4xx business code and the friendly server copy", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: {
          code: "project_slug_taken",
          message: "项目链接已被占用，请换一个名称后重试。",
        },
      }),
    });

    const caught = await createProject("token_abc", { name: "Dup" }).catch(
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(ApiApplicationError);
    const error = caught as ApiApplicationError;
    expect(error.code).toBe("project_slug_taken");
    expect(error.statusCode).toBe(409);
    expect(error.kind).toBe("business");
    expect(error.message).toBe("项目链接已被占用，请换一个名称后重试。");
    expectNoRawEnglish(error.message);
  });

  it("localizes the whole chain in English when the document says en-US", async () => {
    document.documentElement.lang = "en-US";
    mockFetch.mockRejectedValue(new TypeError(RAW_NETWORK));

    const caught = await fetchModels().catch((error: unknown) => error);

    const error = caught as ApiNetworkError;
    expect(error.message).toContain("Cannot reach the server");
    expect(error.message).not.toContain(RAW_NETWORK);
    expect(error.message).not.toContain("网络");
  });

  it("follows the picked language without touching any component", async () => {
    // 用户已经切到英文界面（i18n 写 localStorage），组件没改也要拿到英文文案。
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en-US");
    mockFetch.mockRejectedValue(new TypeError(RAW_NETWORK));

    const caught = await fetchModels().catch((error: unknown) => error);

    expect((caught as ApiNetworkError).message).toContain("Cannot reach the server");
  });
});
