import { describe, expect, it } from "vitest";
import { isSellableVideoModel } from "./video-models.js";

const base = {
  model_id: "video-model",
  display_name: "Video Model",
  price_credits: 0.5,
  input_token_price_cny: null,
  output_token_price_cny: null,
};

describe("isSellableVideoModel", () => {
  it("keeps native per-second video pricing", () => {
    expect(isSellableVideoModel({ ...base, billing_unit: "per_second" })).toBe(true);
  });

  it.each(["per_generation", "per_million_tokens"] as const)(
    "delists %s video pricing",
    (billing_unit) => {
      expect(isSellableVideoModel({ ...base, billing_unit })).toBe(false);
    },
  );

  it("delists zero-priced video models", () => {
    expect(isSellableVideoModel({ ...base, billing_unit: "per_second", price_credits: 0 })).toBe(false);
  });

  it("delists video models above three yuan per second", () => {
    expect(isSellableVideoModel({ ...base, billing_unit: "per_second", price_credits: 3.01 })).toBe(false);
    expect(isSellableVideoModel({ ...base, billing_unit: "per_second", price_credits: 3 })).toBe(true);
  });

  it.each(["gk-video-3", "grok-imagine-video-1.5-preview", "high_aes_general_v30l_zt2i"])(
    "delists retired or unsupported model %s",
    (model_id) => {
      expect(isSellableVideoModel({ ...base, model_id, billing_unit: "per_second" })).toBe(false);
    },
  );
});
