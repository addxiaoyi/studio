import { describe, expect, it } from "vitest";
import { shouldFailoverVideoError } from "../src/lib/generation-error-policy";

describe("video generation failover policy", () => {
  it.each(["model_not_found", "provider_auth_failed", "provider_request_failed", "invalid_provider_response", "upstream_task_failed"])(
    "fails over for %s",
    (code) => expect(shouldFailoverVideoError(code)).toBe(true),
  );

  it.each(["invalid_input", "safety_filter", "timeout", "upstream_outcome_unknown", undefined, null, 401])(
    "does not fail over for %s",
    (code) => expect(shouldFailoverVideoError(code)).toBe(false),
  );
});
