import { afterEach, describe, expect, it } from "vitest";
import {
  clearProviders,
  getAvailableImageModels,
  getAvailableVideoModels,
  registerImageProvider,
  registerVideoProvider,
  resolveImageProviderName,
  resolveVideoProviderName,
} from "./registry.js";

afterEach(() => clearProviders());

describe("provider registry retirement guards", () => {
  it("filters retired image models from catalog and resolution", () => {
    registerImageProvider({
      name: "fixture-image",
      models: [
        { id: "gpt-image-1.5", displayName: "retired", description: "retired" },
        { id: "gpt-image-2", displayName: "active", description: "active" },
        { id: "google/nano-banana", displayName: "disabled", description: "disabled" },
        { id: "google-official/gemini-3-pro-image-preview", displayName: "Nano alias", description: "disabled" },
      ],
      generate: async () => { throw new Error("not called"); },
    });

    expect(getAvailableImageModels().map((model) => model.id)).toEqual(["gpt-image-2"]);
    expect(resolveImageProviderName("gpt-image-2")).toBe("fixture-image");
    expect(() => resolveImageProviderName("gpt-image-1.5")).toThrow(/Retired image model/);
    expect(() => resolveImageProviderName("google-vertex/gemini-2.5-flash-image")).toThrow(/Retired image model/);
  });

  it("filters retired video models from catalog and resolution", () => {
    registerVideoProvider({
      name: "fixture-video",
      models: [
        { id: "gk-video-3", displayName: "retired", description: "retired", capabilities: { textToVideo: true, imageToVideo: false, videoToVideo: false, audio: false }, limits: { maxDuration: 5, allowedDurations: [5], maxResolution: "720p", maxInputImages: 0 } },
        { id: "minimax/hailuo-2.3", displayName: "active", description: "active", capabilities: { textToVideo: true, imageToVideo: true, videoToVideo: false, audio: false }, limits: { maxDuration: 10, allowedDurations: [6, 10], maxResolution: "1080p", maxInputImages: 1 } },
      ],
      generate: async () => { throw new Error("not called"); },
    });

    expect(getAvailableVideoModels().map((model) => model.id)).toEqual(["minimax/hailuo-2.3"]);
    expect(resolveVideoProviderName("minimax/hailuo-2.3")).toBe("fixture-video");
    expect(() => resolveVideoProviderName("gk-video-3")).toThrow(/Retired video model/);
  });

  it("removes token-billed video models from the catalog and provider resolution", () => {
    registerVideoProvider({
      name: "fixture-token-video",
      models: [
        { id: "seedance-2.5-guanfang", displayName: "Seedance Token", description: "token billed", capabilities: { textToVideo: true, imageToVideo: false, videoToVideo: false, audio: false }, limits: { maxDuration: 5, allowedDurations: [5], maxResolution: "720p", maxInputImages: 0 } },
      ],
      generate: async () => { throw new Error("not called"); },
    });

    expect(getAvailableVideoModels()).toEqual([]);
    expect(() => resolveVideoProviderName("seedance-2.5-guanfang")).toThrow(/Retired video model|No provider registered/);
  });
});
