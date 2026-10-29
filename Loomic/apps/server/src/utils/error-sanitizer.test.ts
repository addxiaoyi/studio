import { describe, expect, it } from "vitest";

import { classifyErrorForClient, isRetryableUpstreamError } from "./error-sanitizer.js";

describe("classifyErrorForClient", () => {
  it.each([
    ["HTTP 401 unauthorized", "provider_auth_failed", false],
    ["HTTP 404 model_not_found", "model_disabled", false],
    ["HTTP 429 rate limit", "upstream_rate_limited", true],
    ["provider request timed out", "upstream_timeout", true],
    ["fetch failed", "provider_unavailable", true],
  ] as const)("classifies %s", (message, code, retryable) => {
    expect(classifyErrorForClient(new Error(message))).toMatchObject({
      code,
      retryable,
    });
  });

  it("keeps an HTTP 401 nested in AggregateError as an authentication failure", () => {
    const error = new AggregateError([new Error("HTTP 401 upstream unauthorized")], "Parallel agent operations failed");
    expect(classifyErrorForClient(error)).toMatchObject({ code: "provider_auth_failed", retryable: false });
  });

  it("keeps an HTTP 401 in the cause chain as an authentication failure", () => {
    const error = new Error("Tool execution failed", { cause: new Error("provider returned 401 unauthorized") });
    expect(classifyErrorForClient(error)).toMatchObject({ code: "provider_auth_failed", retryable: false });
  });
});

describe("上游瞬时故障识别（provider_unavailable）", () => {
  it.each([
    ["MiddlewareError: 503 Service temporarily unavailable", "provider_unavailable", true],
    ["HTTP 502 bad gateway", "provider_unavailable", true],
    ["HTTP 504 gateway timeout", "provider_unavailable", true],
    ["HTTP 500 internal server error", "provider_unavailable", true],
    ["read ECONNRESET", "provider_unavailable", true],
    ["socket hang up", "provider_unavailable", true],
    ["Service temporarily unavailable", "provider_unavailable", true],
    ["HTTP 429 rate limit", "upstream_rate_limited", true],
    ["HTTP 408 request timeout", "upstream_timeout", true],
  ] as const)("分类 %s", (message, code, retryable) => {
    expect(classifyErrorForClient(new Error(message))).toMatchObject({ code, retryable });
  });

  it("从结构化字段读取显式状态码", () => {
    const error = Object.assign(new Error("model call failed"), { status: 503 });
    expect(classifyErrorForClient(error)).toMatchObject({ code: "provider_unavailable", retryable: true });
  });

  it("从 cause 链的 response.status 读取显式状态码", () => {
    const cause = Object.assign(new Error("upstream rejected"), { response: { status: 502 } });
    const error = new Error("MiddlewareError", { cause });
    expect(classifyErrorForClient(error)).toMatchObject({ code: "provider_unavailable", retryable: true });
  });

  it("显式状态码优先于文本特征：4xx 不会被文本里的 503 拖成可重试", () => {
    const error = Object.assign(new Error("HTTP 400 invalid_request: upstream once answered 503"), { status: 400 });
    expect(classifyErrorForClient(error).retryable).toBe(false);
    expect(classifyErrorForClient(new Error("HTTP 400 invalid_request: upstream once answered 503")).retryable).toBe(false);
  });

  it.each([
    ["HTTP 422 invalid_request: messages too long", "run_failed", false],
    ["HTTP 401 unauthorized", "provider_auth_failed", false],
    ["HTTP 404 model_not_found", "model_disabled", false],
    ["HTTP 402 insufficient balance", "run_failed", false],
    ["prompt too long for this model context", "run_failed", false],
    ["invalid_request: fetch failed", "run_failed", false],
  ] as const)("用户输入/不可恢复错误 %s 判为不可重试", (message, code, retryable) => {
    expect(classifyErrorForClient(new Error(message))).toMatchObject({ code, retryable });
  });
});

describe("isRetryableUpstreamError", () => {
  it.each([
    ["MiddlewareError: 503 Service temporarily unavailable", true],
    ["HTTP 429 rate limit", true],
    ["HTTP 502 bad gateway", true],
    ["HTTP 401 unauthorized", false],
    ["HTTP 400 invalid_request", false],
    ["HTTP 404 model_not_found", false],
    ["prompt too long for this model context", false],
    ["invalid_request: fetch failed", false],
  ] as const)("%s → %s", (message, expected) => {
    expect(isRetryableUpstreamError(new Error(message))).toBe(expected);
  });
});
