import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficialModelPriceCatalog } from "@helstera/shared";
import { PricingPreview } from "../src/components/landing/pricing-preview";

const api = vi.hoisted(() => ({
  fetchOfficialModelPrices: vi.fn(),
  fetchImageModels: vi.fn(),
  fetchVideoModels: vi.fn(),
}));

vi.mock("@/lib/model-pricing-api", () => ({ fetchOfficialModelPrices: api.fetchOfficialModelPrices }));
vi.mock("@/lib/server-api", () => ({ fetchImageModels: api.fetchImageModels, fetchVideoModels: api.fetchVideoModels }));

const catalog: OfficialModelPriceCatalog = {
  usdCnyRate: 7.2,
  prices: [{
    priceKey: "openai-gpt-image-2-1k-estimate",
    providerKey: "openai",
    providerLabel: "OpenAI API Token 折算估算",
    modelId: "gpt-image-2-1k",
    modelName: "GPT Image 2 1K",
    mediaType: "image",
    variant: "1K",
    officialMin: 0.006,
    officialMax: 0.211,
    currency: "USD",
    unit: "per_image",
    unitLabel: "estimated per image",
    helsteraCredits: 0,
    helsteraUnitLabel: "runtime price",
    note: "OpenAI 官方 Token 单价折算估算",
    sourceId: "openai-gpt-image-2-1k-estimate",
    sourceLabel: "OpenAI 官方 Token 价格折算",
    sourceUrl: "https://platform.openai.com/pricing",
    snapshotDate: "2026-10-14",
    lastVerifiedAt: null,
  }],
  sources: [],
};

describe("landing model price preview", () => {
  beforeEach(() => {
    api.fetchOfficialModelPrices.mockReset().mockResolvedValue(catalog);
    api.fetchImageModels.mockReset().mockResolvedValue({ models: [{
      id: "gpt-image-2-1k",
      displayName: "GPT Image 2 1K",
      description: "高质量图片生成",
      provider: "configured",
      billingUnit: "per_generation",
      creditCost: 0.1,
      providerPriceCny: 0.1,
    }] });
    api.fetchVideoModels.mockReset().mockResolvedValue({ models: [] });
  });

  it("labels GPT Image estimates as token-derived, not fixed per-image official prices", async () => {
    render(<PricingPreview />);

    expect(await screen.findByText("OpenAI 官方 Token 计费换算估算，非固定按张价")).toBeTruthy();
    expect(screen.getByText("GPT Image 2 1K")).toBeTruthy();
  });
});
