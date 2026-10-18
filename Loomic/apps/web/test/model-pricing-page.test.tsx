import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficialModelPriceCatalog } from "@helstera/shared";
import ModelPricingPage from "../src/app/model-pricing/page";

const api = vi.hoisted(() => ({
  fetchOfficialModelPrices: vi.fn(),
  fetchWorkspaceModelPrices: vi.fn(),
  fetchImageModels: vi.fn(),
  fetchVideoModels: vi.fn(),
}));

vi.mock("@/lib/model-pricing-api", () => ({
  fetchOfficialModelPrices: api.fetchOfficialModelPrices,
  fetchWorkspaceModelPrices: api.fetchWorkspaceModelPrices,
}));

vi.mock("@/lib/server-api", () => ({
  fetchImageModels: api.fetchImageModels,
  fetchVideoModels: api.fetchVideoModels,
}));

const catalog: OfficialModelPriceCatalog = {
  usdCnyRate: 7.2,
  prices: [
    {
      priceKey: "image-model-1k",
      providerKey: "image-source",
      providerLabel: "Image Source",
      modelId: "image-model",
      modelName: "Image Model",
      mediaType: "image",
      variant: "1K",
      officialMin: 0.1,
      officialMax: 0.1,
      currency: "USD",
      unit: "per_image",
      unitLabel: "per image",
      helsteraCredits: 2,
      helsteraUnitLabel: "per image",
      note: null,
      sourceId: "image-source",
      sourceLabel: "Image Source",
      sourceUrl: "https://example.com/image",
      snapshotDate: "2026-10-13",
      lastVerifiedAt: null,
    },
    {
      priceKey: "video-model-720p",
      providerKey: "video-source",
      providerLabel: "Video Source",
      modelId: "metaso/MiniMax-H3",
      modelName: "MiniMax H3",
      mediaType: "video",
      variant: "720P",
      officialMin: 0.13,
      officialMax: 0.13,
      currency: "USD",
      unit: "per_second",
      unitLabel: "per second",
      helsteraCredits: 50,
      helsteraUnitLabel: "per 5 seconds",
      note: null,
      sourceId: "video-source",
      sourceLabel: "Video Source",
      sourceUrl: "https://example.com/video",
      snapshotDate: "2026-10-13",
      lastVerifiedAt: null,
    },
  ],
  sources: [],
};

describe("model pricing comparison", () => {
  beforeEach(() => {
    api.fetchOfficialModelPrices.mockReset().mockResolvedValue(catalog);
    api.fetchWorkspaceModelPrices.mockReset().mockResolvedValue({ authenticated: false, models: [] });
    api.fetchImageModels.mockReset().mockResolvedValue({ models: [] });
    api.fetchVideoModels.mockReset().mockResolvedValue({ models: [{
      id: "minimax-h3",
      displayName: "MiniMax H3",
      provider: "configured",
      billingUnit: "per_second",
      providerPriceCny: 0.45,
      creditCost: 0.45,
      accessible: true,
    }] });
  });

  it("uses the current configured Helstera price and avoids comparing unrelated models", async () => {
    render(<ModelPricingPage />);

    expect((await screen.findAllByText("MiniMax H3")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("¥0.94 / 秒").length).toBeGreaterThan(0);
    expect(screen.getAllByText("¥0.45 / 秒").length).toBeGreaterThan(0);
    expect(screen.getAllByText("低于官方最高价 52%").length).toBeGreaterThan(0);
    expect(screen.queryByText("¥12.00 / 秒")).toBeNull();
  });

  it("includes authenticated workspace models when the public catalog does not list them", async () => {
    api.fetchWorkspaceModelPrices.mockResolvedValue({
      authenticated: true,
      models: [{
        modelId: "workspace-only-video",
        displayName: "Workspace Only Video",
        providerLabel: "Private Provider",
        mediaType: "video",
        billingUnit: "per_second",
        priceCny: 0.72,
        inputPriceCny: null,
        outputPriceCny: null,
        modelEnabled: true,
        providerEnabled: true,
        modelHealth: "healthy",
        providerHealth: "healthy",
      }],
    });

    render(<ModelPricingPage />);

    expect((await screen.findAllByText("Workspace Only Video")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("¥0.72 / 秒").length).toBeGreaterThan(0);
  });

  it("excludes token-priced official models from the fixed-price comparison", async () => {
    api.fetchOfficialModelPrices.mockResolvedValue({
      ...catalog,
      prices: [{ ...catalog.prices[0]!, modelId: "image-model", unit: "per_million_tokens", unitLabel: "per million tokens", officialMax: 30, officialMin: 30, variant: "Image output tokens" }],
    });
    api.fetchWorkspaceModelPrices.mockResolvedValue({
      authenticated: true,
      models: [{
        modelId: "image-model",
        displayName: "Token Image Model",
        providerLabel: "OpenAI",
        mediaType: "image",
        billingUnit: "per_million_tokens",
        priceCny: 0.2,
        inputPriceCny: null,
        outputPriceCny: null,
        modelEnabled: true,
        providerEnabled: true,
        modelHealth: "healthy",
        providerHealth: "healthy",
      }],
    });

    render(<ModelPricingPage />);

    expect(screen.queryByText("Token Image Model")).toBeNull();
    expect(screen.queryByText("¥216.00 / 百万 tokens")).toBeNull();
  });

  it("labels GPT Image prices as token-derived estimates rather than fixed official image rates", async () => {
    api.fetchOfficialModelPrices.mockResolvedValue({
      ...catalog,
      prices: [{
        ...catalog.prices[0]!,
        priceKey: "openai-gpt-image-2-1k-estimate",
        providerLabel: "OpenAI API Token 折算估算",
        modelId: "gpt-image-2-1k",
        modelName: "GPT Image 2 1K",
        unit: "per_image",
        officialMax: 0.211,
        officialMin: 0.006,
        sourceId: "openai-gpt-image-2-1k-estimate",
        sourceLabel: "OpenAI 官方 Token 价格折算",
      }],
    });
    api.fetchImageModels.mockResolvedValue({ models: [{
      id: "gpt-image-2-1k",
      displayName: "GPT Image 2 1K",
      description: "高质量图片生成",
      provider: "configured",
      billingUnit: "per_generation",
      providerPriceCny: 0.1,
      creditCost: 0.1,
      accessible: true,
    }] });

    render(<ModelPricingPage />);

    expect(await screen.findAllByText("OpenAI 官方 Token 计费换算估算，非固定按张价")).not.toHaveLength(0);
  });
});
