import { describe, expect, it } from "vitest";

import { classifyErrorForClient } from "./error-sanitizer.js";

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
