import { describe, expect, it } from "vitest";

import {
  calculateImageCost,
  calculateVideoCost,
  getTopupPackage,
  SIGNUP_BONUS_CREDITS,
  TOPUP_PACKAGES,
} from "./credits.js";

describe("calculateImageCost", () => {
  it("returns base cost for standard quality", () => {
    expect(calculateImageCost("gpt-image-1.5", "standard")).toBe(12);
    expect(calculateImageCost("dall-e-3", "standard")).toBe(8);
  });

  it("applies quality multiplier for hd", () => {
    // 12 * 1.5 = 18
    expect(calculateImageCost("gpt-image-1.5", "hd")).toBe(18);
  });

  it("applies quality multiplier for ultra", () => {
    // 12 * 2.0 = 24
    expect(calculateImageCost("gpt-image-1.5", "ultra")).toBe(24);
  });

  it("returns a safe fallback for unknown models", () => {
    expect(calculateImageCost("unknown/model", "standard")).toBe(5);
  });
});

describe("calculateVideoCost", () => {
  it("scales base cost with duration", () => {
    // baseVideoCost=40, 5s = 1x, 8s = 1.6x
    expect(calculateVideoCost("kwaivgi/kling-v2.6", "720p", 5)).toBe(40);
    expect(calculateVideoCost("kwaivgi/kling-v2.6", "720p", 8)).toBe(64);
  });

  it("applies resolution multiplier", () => {
    // base 50, 1080p = 1.5x, 5s
    expect(calculateVideoCost("google-official/veo-3.1-generate-preview", "1080p", 5)).toBe(75);
  });

  it("returns a safe fallback for unknown models", () => {
    expect(calculateVideoCost("unknown/model", "720p", 5)).toBe(40);
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
      const totalCredits = pkg.credits + (pkg.bonusCredits ?? 0);
      const cnyYuan = pkg.priceCnyFen / 100;
      const creditValue = cnyYuan / totalCredits;
      // Each credit should cost at least ¥0.08 (1/12.5)
      expect(creditValue).toBeGreaterThanOrEqual(0.08);
    }
  });

  it("getTopupPackage finds packages by id", () => {
    expect(getTopupPackage("standard-pack")?.credits).toBe(2000);
    expect(getTopupPackage("nonexistent")).toBeNull();
  });

  it("provides signup bonus", () => {
    expect(SIGNUP_BONUS_CREDITS).toBeGreaterThan(0);
  });
});
