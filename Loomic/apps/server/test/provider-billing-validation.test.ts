import { describe, expect, it } from "vitest";
import { validateProviderModelBilling } from "../src/local-db/provider-config-service.js";
import { hasValidBilling } from "../src/http/model-availability.js";

const base = {
  displayName: "model",
  mediaType: "image" as const,
  enabled: true,
  supportsInputImage: false,
  supportsInputVideo: false,
  supportsAudio: false,
  priority: 1,
};

describe("provider model billing validation", () => {
  it("requires both token prices", () => {
    expect(() => validateProviderModelBilling({ ...base, billingUnit: "per_million_tokens", priceCredits: 0, inputTokenPriceCny: 1, outputTokenPriceCny: 0 })).toThrow("输入价和补全价");
  });

  it("accepts a token model with two positive prices", () => {
    expect(() => validateProviderModelBilling({ ...base, billingUnit: "per_million_tokens", priceCredits: 0, inputTokenPriceCny: 15, outputTokenPriceCny: 15 })).not.toThrow();
  });

  it("rejects a zero priced per-generation model", () => {
    expect(() => validateProviderModelBilling({ ...base, billingUnit: "per_generation", priceCredits: 0, inputTokenPriceCny: null, outputTokenPriceCny: null })).toThrow("大于 0");
  });

  it("rejects token fields on per-second billing", () => {
    expect(() => validateProviderModelBilling({ ...base, billingUnit: "per_second", priceCredits: 1, inputTokenPriceCny: 2, outputTokenPriceCny: 2 })).toThrow("不能配置 Token");
  });

  it("does not expose token models with an incomplete price", () => {
    expect(hasValidBilling({
      model_id: "seedance-invalid-price",
      display_name: "Seedance",
      billing_unit: "per_million_tokens",
      price_credits: 0,
      input_token_price_cny: 0,
      output_token_price_cny: 100.8,
    })).toBe(false);
  });
});
