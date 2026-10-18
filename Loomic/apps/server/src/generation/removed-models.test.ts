import { describe, expect, it } from "vitest";
import { isRemovedImageModelId, isRemovedModelId } from "./removed-models.js";
import { VolcesImageProvider } from "./providers/volces-image.js";

describe("isRemovedImageModelId", () => {
  it.each(["gpt-image-1", "openai/gpt-image-1", "replicate/openai/gpt-image-1", "openai:gpt-image-1", "gpt-image-1.5", "openai/gpt-image-1.5", "replicate/openai/gpt-image-1.5", "openai:gpt-image-1.5", "doubao-seededit-3-0-i2i-250628", "volces/doubao-seededit-3-0-i2i-250628", "high_aes_general_v30l_zt2i", "volces/high_aes_general_v30l_zt2i", "google/nano-banana-pro", "google-official/gemini-3.1-flash-image-preview", "google-vertex/gemini-3-pro-image-preview"])(
    "blocks retired model alias %s",
    (modelId) => expect(isRemovedImageModelId(modelId)).toBe(true),
  );

  it.each(["gpt-image-2", "openai/gpt-image-2-1k"])(
    "keeps supported model %s",
    (modelId) => expect(isRemovedImageModelId(modelId)).toBe(false),
  );

  it("does not advertise the retired Volces SeedEdit model", () => {
    const models = new VolcesImageProvider("test-key").models;
    expect(models.map((model) => model.id)).not.toContain("doubao-seededit-3-0-i2i-250628");
    expect(models.map((model) => model.id)).toContain("doubao-seedream-3-0-t2i-250415");
  });
});

describe("isRemovedModelId", () => {
  it.each(["grok-4.6", "openai:grok-4.6", "grok-imagine-video-1.5-preview", "gk-video-3", "provider/gk-video-3.5"]) (
    "blocks retired Grok family model %s",
    (modelId) => expect(isRemovedModelId(modelId)).toBe(true),
  );

  it.each(["hailuo-h3", "minimax-h3-max", "kling-motion-control-v3", "happyhorse-1.1-i2v"])(
    "keeps price-policy models available for dynamic price filtering: %s",
    (modelId) => expect(isRemovedModelId(modelId)).toBe(false),
  );

  it("keeps supported non-Grok models", () => {
    expect(isRemovedModelId("agnes-3.0-flash")).toBe(true);
    expect(isRemovedModelId("minimax-h3")).toBe(false);
    expect(isRemovedModelId("video-model")).toBe(false);
  });
});
