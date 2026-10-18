import { describe, expect, it } from "vitest";
import { buildMediaRoute, normalizeMediaIntent } from "./media-routing.js";

describe("media routing policy", () => {
  const silent = { model_id: "minimax-h3", supports_input_image: true, supports_audio: false, max_duration_seconds: 15 };

  it("normalizes audio off for a silent model", () => {
    expect(normalizeMediaIntent({ mediaType: "video", inputImageCount: 1, inputVideo: false, enableAudio: false, selectionMode: "auto" }, silent)).toMatchObject({ enableAudio: false, inputImageCount: 1 });
  });

  it("rejects incompatible audio before a job can be created", () => {
    expect(() => normalizeMediaIntent({ mediaType: "video", inputImageCount: 0, inputVideo: false, enableAudio: true, selectionMode: "auto" }, silent)).toThrow(/audio/);
  });

  it("records automatic fallback metadata", () => {
    expect(buildMediaRoute({
      intent: { mediaType: "video", inputImageCount: 0, inputVideo: false, enableAudio: false, requestedModel: "offline-model", selectionMode: "auto" },
      selected: silent,
      candidates: ["minimax-h3", "offline-model"],
    })).toMatchObject({ requestedModel: "offline-model", selectedModel: "minimax-h3", fallback: true });
    expect(buildMediaRoute({
      intent: { mediaType: "video", inputImageCount: 1, inputVideo: false, enableAudio: false, requestedModel: "offline-model", selectionMode: "auto" },
      selected: silent,
      candidates: ["minimax-h3", "offline-model"],
    })).toMatchObject({ requestedModels: ["minimax-h3", "offline-model"], preferredModel: "offline-model", inputImage: true });
  });
});
