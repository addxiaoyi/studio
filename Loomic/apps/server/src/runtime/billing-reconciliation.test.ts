import { describe, expect, it } from "vitest";
import { BillingReconciliationError, calculateActualGenerationCredits } from "./billing-reconciliation.js";

describe("generation billing reconciliation", () => {
  it("settles per-second video billing from the provider duration", () => {
    expect(calculateActualGenerationCredits("MiniMax-H3", { duration_seconds: 12 })).toEqual({
      actualCost: 3.6,
      description: "Video provider usage (12s at 0.3 credits/s)",
      basis: { unit: "per_second", model: "MiniMax-H3", seconds: 12, creditsPerSecond: 0.3 },
    });
  });

  it("uses frozen pricing instead of the current catalog rate", () => {
    const quote = { billingUnit: "per_second" as const, creditCost: 0.2 };
    expect(calculateActualGenerationCredits("MiniMax-H3", { duration_seconds: 12 }, quote))
      .toMatchObject({ actualCost: 2.4, basis: { creditsPerSecond: 0.2 } });
  });

  it("rejects a per-second result without an actual provider duration", () => {
    expect(() => calculateActualGenerationCredits("MiniMax-H3", {})).toThrowError(
      expect.objectContaining({ code: "missing_provider_duration" }),
    );
  });

  it.each(["request_fallback", "unknown"])("does not bill display duration with source %s", duration_source => {
    expect(() => calculateActualGenerationCredits("MiniMax-H3", { duration_seconds: 12, duration_source }))
      .toThrowError(expect.objectContaining({ code: "missing_provider_duration" }));
  });

  it("keeps token billing tied to returned usage", () => {
    const result = calculateActualGenerationCredits("doubao-seedance-2.0-720p", {
      usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
    });
    expect(result?.actualCost).toBeGreaterThan(0);
    expect(result?.description).toContain("1000000 input");
  });

  it("rejects token billing when usage is absent", () => {
    expect(() => calculateActualGenerationCredits("doubao-seedance-2.0-720p", {})).toThrow(
      BillingReconciliationError,
    );
  });

  it.each([NaN, Infinity, -1, 1.25, Number.MAX_SAFE_INTEGER + 1])("rejects invalid token usage %s before touching the ledger", tokens => {
    expect(() => calculateActualGenerationCredits("doubao-seedance-2.0-720p", { usage: { inputTokens: tokens, outputTokens: 5 } })).toThrow(BillingReconciliationError);
    expect(() => calculateActualGenerationCredits("doubao-seedance-2.0-720p", { usage: { inputTokens: 5, outputTokens: tokens } })).toThrow(BillingReconciliationError);
  });
});
