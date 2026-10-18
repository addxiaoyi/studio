import { describe, expect, it } from "vitest";
import { readGenerationToolErrorCode } from "./generation-error-code.js";

describe("generation error code normalization", () => {
  it("reads known codes from the top-level error", () => {
    expect(readGenerationToolErrorCode({ code: "provider_auth_failed" })).toBe("provider_auth_failed");
    expect(readGenerationToolErrorCode({ code: "unknown_code" })).toBeUndefined();
  });

  it("walks Error cause chains", () => {
    const root = new Error("wrapper", { cause: Object.assign(new Error("auth"), { code: "provider_auth_failed" }) });
    expect(readGenerationToolErrorCode(root)).toBe("provider_auth_failed");
  });

  it("walks AggregateError errors and does not loop on cyclic causes", () => {
    const first = Object.assign(new Error("one"), { code: "invalid_input" });
    const aggregate = new AggregateError([new Error("other"), first], "combined");
    expect(readGenerationToolErrorCode(aggregate)).toBe("invalid_input");

    const cyclic: Record<string, unknown> = {};
    cyclic.cause = cyclic;
    expect(readGenerationToolErrorCode(cyclic)).toBeUndefined();
  });
});
