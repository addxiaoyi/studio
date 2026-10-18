import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficialModelPriceCatalog } from "@helstera/shared";
import { HomeModelPricePreview } from "../src/components/home-model-price-preview";

const api = vi.hoisted(() => ({
  fetchPrices: vi.fn(),
  fetchImages: vi.fn(),
  fetchVideos: vi.fn(),
}));

vi.mock("@/lib/model-pricing-api", () => ({ fetchOfficialModelPrices: api.fetchPrices }));
vi.mock("@/lib/server-api", () => ({ fetchImageModels: api.fetchImages, fetchVideoModels: api.fetchVideos }));

const catalog: OfficialModelPriceCatalog = {
  usdCnyRate: 7.2,
  prices: [
    {
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
      note: "OpenAI 官方 Token 单价换算估算",
      sourceId: "openai-gpt-image-2-1k-estimate",
      sourceLabel: "OpenAI 官方 Token 价格折算",
      sourceUrl: "https://platform.openai.com/pricing",
      snapshotDate: "2026-10-14",
      lastVerifiedAt: null,
    },
    {
      priceKey: "google-veo-31-720p",
      providerKey: "google",
      providerLabel: "Google Gemini API",
      modelId: "veo-3.1",
      modelName: "Veo 3.1",
      mediaType: "video",
      variant: "720p",
      officialMin: 0.4,
      officialMax: 0.6,
      currency: "USD",
      unit: "per_second",
      unitLabel: "per second",
      helsteraCredits: 50,
      helsteraUnitLabel: "per 5 seconds",
      note: null,
      sourceId: "google",
      sourceLabel: "Google",
      sourceUrl: "https://example.com/google",
      snapshotDate: "2026-10-13",
      lastVerifiedAt: null,
    },
  ],
  sources: [{
    sourceId: "google",
    label: "Google",
    url: "https://example.com/google",
    automatic: true,
    status: "success",
    lastAttemptAt: "2026-10-13T10:00:00.000Z",
    lastSuccessAt: "2026-10-13T10:00:00.000Z",
    itemCount: 2,
  }],
};

describe("HomeModelPricePreview", () => {
  beforeEach(() => {
    api.fetchPrices.mockReset().mockResolvedValue(catalog);
    api.fetchImages.mockReset().mockResolvedValue({ models: [{
      id: "gpt-image-2-1k",
      displayName: "GPT Image 2 1K",
      description: "1K 图片生成",
      provider: "configured",
      billingUnit: "per_generation",
      providerPriceCny: 0.1,
      creditCost: 0.1,
      accessible: true,
      availability: "unverified",
    }] });
    api.fetchVideos.mockReset().mockResolvedValue({ models: [{
      id: "veo-3.1",
      displayName: "Veo 3.1",
      description: "视频生成",
      provider: "configured",
      billingUnit: "per_second",
      providerPriceCny: 0.4,
      creditCost: 0.4,
      accessible: true,
      availability: "available",
      capabilities: { textToVideo: true, imageToVideo: true, videoToVideo: false, audio: true },
      limits: { maxDuration: 8, maxResolution: "1080p", maxInputImages: 1 },
    }] });
  });

  it("uses real callable image and video models, including image filtering", async () => {
    render(<HomeModelPricePreview />);

    expect(await screen.findByText("GPT Image 2 1K")).toBeTruthy();
    expect(screen.getByText("Veo 3.1")).toBeTruthy();
    expect(screen.getByText("¥1.52 / 张")).toBeTruthy();
    expect(screen.getByText("¥0.10 / 张")).toBeTruthy();
    expect(screen.getByText("¥4.32 / 秒")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "图片" }));
    expect(screen.getByText("GPT Image 2 1K")).toBeTruthy();
    expect(screen.queryByText("Veo 3.1")).toBeNull();
    expect(screen.getByText("OpenAI 官方 Token 计费换算估算，非固定按张价")).toBeTruthy();
  });

  it("shows a real empty state if no callable model has a cheaper verified price", async () => {
    api.fetchImages.mockResolvedValue({ models: [] });
    api.fetchVideos.mockResolvedValue({ models: [] });
    render(<HomeModelPricePreview />);

    expect(await screen.findByText((content) => content.includes("没有同时匹配官方价格且低于官方价的模型"))).toBeTruthy();
  });

  it("keeps unverified configured models visible with a pending status", async () => {
    api.fetchVideos.mockResolvedValue({ models: [{
      id: "veo-3.1",
      displayName: "Veo 3.1",
      description: "��Ƶ����",
      provider: "configured",
      billingUnit: "per_second",
      providerPriceCny: 0.4,
      creditCost: 0.4,
      accessible: true,
      availability: "unverified",
    }] });
    render(<HomeModelPricePreview />);

    expect(await screen.findByText("待验证")).toBeTruthy();
  });
});
