import { describe, expect, it } from "vitest";

import {
  calculateImageCost,
  calculateVideoCost,
  calculateAgentTokenCharge,
  getTopupPackage,
  HELSTERA_AGENT_TOKEN_PRICES_CNY,
  SIGNUP_BONUS_CREDITS,
  TOPUP_PACKAGES,
  calculateTokenCredits,
  getConfiguredBilling,
  getAgentMessagePrice,
} from "./credits.js";
import { getConfiguredVideoPriceRates, resolveVideoResolution } from "./upstream-pricing.js";

describe("agent message billing", () => {
  it("charges HY3 at one cent per message", () => {
    expect(getAgentMessagePrice("hy3")).toBe(0.01);
    expect(getAgentMessagePrice("openai:hy3")).toBe(0.01);
    expect(getAgentMessagePrice("minimax-hy3")).toBe(0.01);
  });

  it("prices HelsteraAgent input and output tokens separately per million", () => {
    expect(HELSTERA_AGENT_TOKEN_PRICES_CNY).toEqual({ input: 0.1, output: 0.5 });
    expect(calculateAgentTokenCharge(1_000, 1_000)).toBe(0.0006);
    expect(calculateAgentTokenCharge(0, 1)).toBe(0.0001);
  });
});

describe("calculateImageCost", () => {
  it("returns base cost for standard quality", () => {
    expect(calculateImageCost("dall-e-3", "standard")).toBe(8);
  });

  it("applies quality multiplier for hd", () => {
    expect(calculateImageCost("dall-e-3", "hd")).toBe(12);
  });

  it("applies quality multiplier for ultra", () => {
    expect(calculateImageCost("dall-e-3", "ultra")).toBe(16);
  });

  it("rejects unpriced models", () => {
    expect(() => calculateImageCost("unknown/model", "standard")).toThrow();
  });

  it("reserves a stable amount before token usage is known", () => {
    expect(calculateImageCost("doubao-seedance-2.0-720p", "hd")).toBe(1);
  });
});

describe("token billing", () => {
  it("rounds token charges up to whole credits", () => {
    expect(calculateTokenCredits(500_000, 500_000, 72)).toBe(72);
    expect(calculateTokenCredits(1, 0, 72)).toBe(0.0001);
  });

  it("rejects invalid usage", () => {
    expect(() => calculateTokenCredits(-1, 0, 72)).toThrow();
  });
});

describe("configured model billing catalog", () => {
  it("does not expose retired image model pricing", () => {
    expect(getConfiguredBilling("gpt-image-1.5")).toBeNull();
    expect(getConfiguredBilling("doubao-seededit-3-0-i2i-250628")).toBeNull();
  });

  it("uses one catalog for image, video, and token billed models", () => {
    expect(getConfiguredBilling("gpt-image-2-1k")).toMatchObject({
      billingUnit: "per_generation",
    });
    expect(getConfiguredBilling("gpt-image-2-1k")?.creditCost).toBeCloseTo(0.2);
    expect(getConfiguredBilling("gpt-image-2")?.creditCost).toBeCloseTo(0.2);
    expect(getConfiguredBilling("gpt-image-2-2k")?.creditCost).toBeCloseTo(0.32);
    expect(getConfiguredBilling("gpt-image-2-4k")?.creditCost).toBeCloseTo(1.2);
    expect(getConfiguredBilling("gpt-image-2-4k-超分")?.creditCost).toBeCloseTo(0.8);
    expect(getConfiguredBilling("gpt-image-2.5-1k")?.creditCost).toBeCloseTo(0.16);
    expect(getConfiguredBilling("gpt-image-2.5-2k")?.creditCost).toBeCloseTo(0.32);
    expect(getConfiguredBilling("gpt-image-2.5-4k")?.creditCost).toBeCloseTo(0.8);
    expect(getConfiguredBilling("sora-2-12s")).toMatchObject({
      billingUnit: "per_generation",
    });
    expect(getConfiguredBilling("sora-2-12s")?.creditCost).toBeCloseTo(0.8);
    expect(getConfiguredBilling("doubao-seedance-2.0-720p")).toEqual({
      billingUnit: "per_million_tokens",
      inputTokenPriceCny: 49.6,
      outputTokenPriceCny: 49.6,
    });
  });
});

describe("calculateVideoCost", () => {
  it("aligns default and legacy resolutions with billing and rejects unsupported output sizes", () => {
    expect(resolveVideoResolution("MiniMax-H3")).toBe("768p");
    expect(resolveVideoResolution("MiniMax-H3", "720p")).toBe("768p");
    expect(resolveVideoResolution("MiniMax-H3", "1080p")).toBe("1088p");
    expect(calculateVideoCost("MiniMax-H3")).toBeCloseTo(1.5);
    expect(() => calculateVideoCost("MiniMax-H3", "4k", 5)).toThrow("Unsupported resolution");
  });
  it("charges MiniMax H3 using the selected output resolution and duration", () => {
    expect(calculateVideoCost("MiniMax-H3", "480p", 1)).toBeCloseTo(0.22);
    expect(calculateVideoCost("minimax-h3", "768p", 5)).toBeCloseTo(1.5);
    expect(calculateVideoCost("minimax-h3", "1088p", 15)).toBeCloseTo(5.1);
    expect(calculateVideoCost("minimax-h3", "1440p", 5)).toBeCloseTo(1.9);
  });
  it("publishes the configured final unit prices for all MiniMax H3 resolutions", () => {
    expect(getConfiguredVideoPriceRates("MiniMax-H3")).toEqual([
      { resolution: "480p", priceCnyPerSecond: 0.22 },
      { resolution: "768p", priceCnyPerSecond: 0.3 },
      { resolution: "1088p", priceCnyPerSecond: 0.34 },
      { resolution: "1440p", priceCnyPerSecond: 0.38 },
    ]);
  });
  it("prices the Seedance 2.5 full version at 50% gross margin on its published floor cost", () => {
    expect(getConfiguredBilling("seedance-2.5-guanfang-anmiao")).toMatchObject({
      billingUnit: "per_second",
      creditCost: 0.9792,
    });
    expect(calculateVideoCost("seedance-2.5-guanfang-anmiao", "1080p", 5)).toBeCloseTo(4.896);
  });
  it("uses the supplied upstream costs for every mapped billing unit", () => {
    expect(getConfiguredBilling("gk-video-3.5")).toEqual({ billingUnit: "per_second", creditCost: 0.454 });
    expect(getConfiguredBilling("MiniMax-H3")).toEqual({ billingUnit: "per_second", creditCost: 0.3 });
    expect(getConfiguredBilling("omni_flash-10s")).toEqual({ billingUnit: "per_generation", creditCost: 2.9376 });
    expect(getConfiguredBilling("seedance-2.5-guanfang")).toEqual({ billingUnit: "per_million_tokens", inputTokenPriceCny: 193.536, outputTokenPriceCny: 193.536 });
  });
  it("scales base cost with duration", () => {
    // baseVideoCost=40, 5s = 1x, 8s = 1.6x
    expect(calculateVideoCost("kwaivgi/kling-v2.6", "720p", 5)).toBe(40);
    expect(calculateVideoCost("kwaivgi/kling-v2.6", "720p", 8)).toBe(64);
  });

  it("applies resolution multiplier", () => {
    // base 50, 1080p = 1.5x, 5s
    expect(
      calculateVideoCost(
        "google-official/veo-3.1-generate-preview",
        "1080p",
        5,
      ),
    ).toBe(75);
  });

  it("rejects unpriced models", () => {
    expect(() => calculateVideoCost("unknown/model", "720p", 5)).toThrow();
  });
});

describe("topup packages", () => {
  it("lists packages in stable order", () => {
    expect(TOPUP_PACKAGES.map((p) => p.id)).toEqual([
      "starter-pack",
      "standard-pack",
      "pro-pack",
      "business-pack",
    ]);
  });

  it("has unique package ids", () => {
    const ids = TOPUP_PACKAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("credits-to-cny ratio is at least 8 (sub-15% markup)", () => {
    for (const pkg of TOPUP_PACKAGES) {
      const totalCredits = pkg.priceCnyFen / 100;
      const cnyYuan = pkg.priceCnyFen / 100;
      const creditValue = cnyYuan / totalCredits;
      // Each credit should cost at least ¥0.08 (1/12.5)
      expect(creditValue).toBeGreaterThanOrEqual(0.08);
    }
  });

  it("getTopupPackage finds packages by id", () => {
    expect(getTopupPackage("standard-pack")?.credits).toBe(200);
    expect(getTopupPackage("nonexistent")).toBeNull();
  });

  it("does not mix signup bonuses into paid balance", () => {
    expect(SIGNUP_BONUS_CREDITS).toBe(0);
  });
});
