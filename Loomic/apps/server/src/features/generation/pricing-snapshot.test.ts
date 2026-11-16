import { describe, expect, it } from "vitest";
import { snapshotCatalogPricing } from "./pricing-snapshot.js";

describe("approval price snapshots", () => {
  it("preserves the quoted resolution rate instead of recomputing the catalog default", () => {
    expect(snapshotCatalogPricing("MiniMax-H3", { duration: 10, resolution: "1080p" }, 4.5))
      .toEqual({ billingUnit: "per_second", creditCost: 0.45 });
  });

  it("does not invent a per-second rate from an absent or invalid duration", () => {
    for (const duration of [undefined, 0, -1, Infinity, "10"]) {
      expect(snapshotCatalogPricing("MiniMax-H3", { duration }, 4.5)).toBeNull();
    }
  });

  it("requires configured token prices and preserves both token rates", () => {
    const price = snapshotCatalogPricing("doubao-seedance-2.0-720p", {}, 1);
    expect(price).toMatchObject({ billingUnit: "per_million_tokens", inputTokenPriceCny: expect.any(Number), outputTokenPriceCny: expect.any(Number) });
    expect(snapshotCatalogPricing("unknown-custom-model", {}, 1)).toBeNull();
  });
});
