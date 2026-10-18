import { describe, expect, it } from "vitest";

import { supportsReferenceImage } from "./provider-config-service.js";

describe("supportsReferenceImage", () => {
  it.each([
    "gpt-image-2",
    "gpt-image-2-1k",
    "nano-banana-2-1k",
    "black-forest-labs/flux-kontext-pro",
  ])("recognizes reference-image model %s", (modelId) => {
    expect(supportsReferenceImage(modelId)).toBe(true);
  });

  it("does not infer reference support for unknown image models", () => {
    expect(supportsReferenceImage("dall-e-3")).toBe(false);
  });
});
