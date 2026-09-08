// @topup-system — Unit tests for topup pricing math and resolution
import { describe, expect, it } from "vitest";

import {
  TOPUP_PACKAGES,
  getTopupPackage,
  applyTopupVariants,
  getUsdCentsForCnyFen,
} from "@helstera/shared";

describe("topup package definitions", () => {
  it("contains at least 3 distinct packages", () => {
    expect(TOPUP_PACKAGES.length).toBeGreaterThanOrEqual(3);
  });

  it("all package ids are unique", () => {
    const ids = TOPUP_PACKAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all packages have positive credits and prices", () => {
    for (const pkg of TOPUP_PACKAGES) {
      expect(pkg.credits).toBeGreaterThan(0);
      expect(pkg.priceCnyFen).toBeGreaterThan(0);
      expect(pkg.priceUsdCents).toBeGreaterThan(0);
    }
  });

  it("packages are sorted by sortOrder ascending", () => {
    const orders = TOPUP_PACKAGES.map((p) => p.sortOrder);
    const sorted = [...orders].sort((a, b) => a - b);
    expect(orders).toEqual(sorted);
  });

  it("exactly one package is marked as recommended", () => {
    const recommended = TOPUP_PACKAGES.filter((p) => p.recommended);
    expect(recommended.length).toBe(1);
  });
});

describe("getTopupPackage", () => {
  it("returns the matching package", () => {
    const firstPkg = TOPUP_PACKAGES[0];
    expect(firstPkg).toBeDefined();
    if (!firstPkg) return;
    const pkg = getTopupPackage(firstPkg.id);
    expect(pkg).not.toBeNull();
    expect(pkg?.id).toBe(firstPkg.id);
  });

  it("returns null for an unknown id", () => {
    expect(getTopupPackage("does-not-exist")).toBeNull();
  });
});

describe("applyTopupVariants", () => {
  it("attaches Lemon Squeezy variant ids from env", () => {
    const result = applyTopupVariants({
      LEMON_SQUEEZY_TOPUP_VARIANT_STARTER_PACK: "vs_abc",
      LEMON_SQUEEZY_TOPUP_VARIANT_PRO_PACK: "vs_xyz",
    });
    const starter = result.find((p) => p.id === "starter-pack");
    const pro = result.find((p) => p.id === "pro-pack");
    const standard = result.find((p) => p.id === "standard-pack");

    expect(starter?.lemonSqueezyVariantId).toBe("vs_abc");
    expect(pro?.lemonSqueezyVariantId).toBe("vs_xyz");
    expect(standard?.lemonSqueezyVariantId).toBeUndefined();
  });

  it("preserves all other package fields when applying variants", () => {
    const result = applyTopupVariants({
      LEMON_SQUEEZY_TOPUP_VARIANT_STANDARD_PACK: "vs_test",
    });
    const standard = result.find((p) => p.id === "standard-pack")!;
    expect(standard.credits).toBeGreaterThan(0);
    expect(standard.priceCnyFen).toBeGreaterThan(0);
  });
});

describe("FX conversion (USD ↔ CNY)", () => {
  // Test the conversion math is in the right ballpark.
  // 1 USD ≈ 7.2 CNY → ¥10 should cost about $1.39.
  it("convertCnyToUsd (¥10 → ~$1.39)", () => {
    const usdCents = getUsdCentsForCnyFen(1000);
    // 1000 fen = ¥10. At rate 7.2, that's ~$1.39 (139 cents).
    // Allow ±10% range to account for rate updates.
    expect(usdCents).toBeGreaterThan(125);
    expect(usdCents).toBeLessThan(155);
  });

  it("zero CNY → zero USD", () => {
    expect(getUsdCentsForCnyFen(0)).toBe(0);
  });
});
