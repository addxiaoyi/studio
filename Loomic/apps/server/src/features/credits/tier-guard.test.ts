import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createLocalCostGuard } from "./tier-guard.js";

function createGuard(priceCredits: number) {
  const db = {
    query: vi.fn().mockResolvedValue({
      rows: [{
        billing_unit: "per_second",
        price_credits: priceCredits,
        input_token_price_cny: null,
        output_token_price_cny: null,
      }],
    }),
  };
  return { guard: createLocalCostGuard(db as unknown as Pool), db };
}

describe("local video credit guard", () => {
  it("uses the chosen MiniMax H3 resolution rate instead of the model ceiling", async () => {
    const { guard } = createGuard(0.38);

    await expect(guard.calculateCreditCost("MiniMax-H3", "video_generation", {
      duration: 10,
      resolution: "1088p",
    })).resolves.toBeCloseTo(3.4);
  });

  it("continues to use database pricing for other configured providers", async () => {
    const { guard } = createGuard(0.5);

    await expect(guard.calculateCreditCost("another-video", "video_generation", {
      duration: 4,
      resolution: "1080p",
    })).resolves.toBe(2);
  });
});
