import { describe, expect, it } from "vitest";
import { getModelPricingLabel } from "@/lib/model-pricing";

describe("getModelPricingLabel", () => {
  it("uses yuan per second for video models", () => {
    expect(getModelPricingLabel({ billingUnit: "per_second", providerPriceCny: 0.51 }, "video")).toBe("¥0.51 / 秒 · 最终售价");
  });

  it("does not present per-generation video models as sellable", () => {
    expect(getModelPricingLabel({ billingUnit: "per_generation", providerPriceCny: 1.2 }, "video")).toBe("未上架 · 视频须按元/秒定价");
  });
});
