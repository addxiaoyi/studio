import { describe, expect, it } from "vitest";
import { classifyBuiltInModel, getModelCallProfile, validateProfileInput } from "./model-call-profiles.js";
import { OpenAIImageProvider } from "../generation/providers/openai-image.js";
import { ReplicateImageProvider } from "../generation/providers/replicate-image.js";
import { VolcesImageProvider } from "../generation/providers/volces-image.js";
import { GoogleImageProvider } from "../generation/providers/google-image.js";
import { GoogleVertexImageProvider } from "../generation/providers/google-vertex-image.js";
import { GoogleVideoProvider } from "../generation/providers/google-video.js";
import { GoogleVertexVideoProvider } from "../generation/providers/google-vertex-video.js";
import { MetasoVideoProvider } from "../generation/providers/metaso-video.js";
import { ReplicateVideoProvider } from "../generation/providers/replicate-video.js";

describe("model call profiles", () => {
  it("uses the MiniMax Lingke contract", () => {
    const profile = getModelCallProfile("minimax-h3", "lingke_media");
    expect(profile.id).toBe("minimax-lingke");
    expect(profile.minimumInputImageEdge).toBe(300);
    expect(profile.mapResolution(undefined, "480p")).toBe("768P");
    expect(profile.mapResolution("1080p", "480p")).toBe("2K");
  });

  it("keeps generic configured models generic", () => {
    expect(getModelCallProfile("custom-video", "custom").id).toBe("generic");
  });

  it("exposes per-family Replicate and Veo constraints", () => {
    expect(getModelCallProfile("kwaivgi/kling-v3-video", "").acceptedDurations).toEqual([3, 5, 10, 15]);
    expect(getModelCallProfile("bytedance/seedance-1.5-pro", "").maxInputImages).toBe(1);
    expect(getModelCallProfile("wan-video/wan-2.6", "").requestAdapter).toContain("wan-t2v-i2v");
    expect(getModelCallProfile("google-official/veo-3.1-generate-preview", "").acceptedAspectRatios).toEqual(["16:9", "9:16"]);
    expect(getModelCallProfile("google-official/veo-2.0-generate-001", "").acceptedDurations).toContain(5);
    expect(getModelCallProfile("google-vertex/veo-2.0-generate-001", "").acceptedDurations).toContain(8);
  });

  it.each([
    ["kwaivgi/kling-v3-video", "replicate-kling"],
    ["bytedance/seedance-1.5-pro", "replicate-seedance"],
    ["wan-video/wan-2.6", "replicate-wan"],
    ["google-official/veo-3.1-generate-preview", "google-veo"],
    ["google-vertex/veo-3.1-generate-001", "google-vertex-veo"],
    ["gpt-image-2", "openai-image"],
  ] as const)("classifies %s into %s", (model, family) => {
    expect(classifyBuiltInModel(model)).toBe(family);
  });

  it("distinguishes provider-qualified model families", () => {
    expect(classifyBuiltInModel("minimax-h3", "lingke_media")).toBe("minimax-lingke");
    expect(classifyBuiltInModel("metaso/minimax-h3", "")).toBe("metaso-minimax");
    expect(classifyBuiltInModel("google-official/veo-3.1-fast-generate-preview", "")).toBe("google-veo");
    expect(classifyBuiltInModel("google-vertex/veo-3.1-generate-001", "")).toBe("google-vertex-veo");
    expect(classifyBuiltInModel("google/imagen-4", "replicate")).toBe("replicate-google-image");
  });

  it.each([
    ["gpt-image-2", "openai", "kuaipao-image"],
    ["gpt-image-1", "openai", "openai-image"],
    ["dall-e-3", "openai", "openai-dalle-image"],
    ["google-official/gemini-3-pro-image-preview", "gemini", "gemini-image"],
    ["black-forest-labs/flux-kontext-pro", "replicate", "flux-image"],
  ] as const)("classifies image request %s/%s", (model, format, family) => {
    expect(classifyBuiltInModel(model, format)).toBe(family);
    expect(getModelCallProfile(model, format).requestAdapter).not.toBe("configured-template");
  });

  it("does not classify Replicate Imagen as the official Gemini image API", () => {
    expect(classifyBuiltInModel("google/imagen-4", "replicate")).toBe("replicate-google-image");
    expect(classifyBuiltInModel("google-official/gemini-3-pro-image-preview", "gemini")).toBe("gemini-image");
  });

  it("keeps image transport and response protocols provider-specific", () => {
    expect(getModelCallProfile("gpt-image-2", "openai")).toMatchObject({ inputImageTransport: "native", requestAdapter: "kuaipao-image-endpoint", responseAdapter: "b64-json-or-url" });
    expect(getModelCallProfile("gpt-image-2", "openai").id).toBe("kuaipao-image");
    expect(getModelCallProfile("gpt-image-1", "openai")).toMatchObject({ id: "openai-image", inputImageTransport: "native", requestAdapter: "openai-sdk-images-generate", responseAdapter: "openai-b64-or-url" });
    expect(getModelCallProfile("dall-e-3", "openai")).toMatchObject({ requestAdapter: "openai-sdk-images-generate", responseAdapter: "openai-url-only" });
    expect(getModelCallProfile("google-official/gemini-3-pro-image-preview", "gemini")).toMatchObject({ inputImageTransport: "native", requestAdapter: "gemini-content-parts", responseAdapter: "gemini-inline-image" });
    expect(getModelCallProfile("black-forest-labs/flux-kontext-pro", "replicate")).toMatchObject({ inputImageTransport: "provider_url", requestAdapter: "replicate-model-input:flux", responseAdapter: "replicate-prediction-output" });
  });

  it("maps every official OpenAI image model catalog entry to an explicit profile", () => {
    const modelIds = new OpenAIImageProvider("test-key").models.map((model) => model.id);
    for (const model of modelIds) {
      const profile = getModelCallProfile(model, "openai");
      expect(profile.id, model).not.toBe("generic");
      expect(profile.requestAdapter, model).not.toBe("configured-template");
      expect(profile.responseAdapter, model).not.toBe("configured-response-paths");
    }
    expect(getModelCallProfile("gpt-image-1", "openai").id).toBe("openai-image");
    expect(getModelCallProfile("dall-e-3", "openai").id).toBe("openai-dalle-image");
    expect(getModelCallProfile("gpt-image-2", "openai").id).toBe("kuaipao-image");
  });

  it("maps every Replicate image catalog model to an explicit input adapter profile", () => {
    const modelIds = new ReplicateImageProvider("test-token").models.map((model) => model.id);
    for (const model of modelIds) {
      const profile = getModelCallProfile(model, "replicate");
      expect(profile.id, model).not.toBe("generic");
      expect(profile.requestAdapter, model).toContain("replicate-model-input:");
      expect(profile.responseAdapter, model).toBe("replicate-prediction-output");
    }
    expect(getModelCallProfile("google/imagen-4", "replicate").id).toBe("replicate-google-image");
    expect(getModelCallProfile("google/nano-banana-pro", "replicate").requestAdapter).toBe("replicate-model-input:google-image");
    expect(getModelCallProfile("bytedance/seedream-4.5", "replicate").requestAdapter).toBe("replicate-model-input:seedream");
    expect(getModelCallProfile("recraft-ai/recraft-v3", "replicate").requestAdapter).toBe("replicate-model-input:recraft");
  });

  it("maps every model exposed by the Ark Volces provider to the Volces image profile", () => {
    for (const model of new VolcesImageProvider("test-key").models) {
      expect(getModelCallProfile(model.id, "volces")).toMatchObject({ id: "volces-image", maxInputImages: 0 });
      expect(classifyBuiltInModel(model.id, "volces")).toBe("volces-image");
    }
    expect(classifyBuiltInModel("high_aes_general_v30l_zt2i", "volces")).toBe("configured-generic");
  });

  it("keeps every registered provider catalog model on an explicit profile", () => {
    const catalogs: Array<{ name: string; format: string; models: readonly { id: string }[] }> = [
      { name: "openai", format: "openai", models: new OpenAIImageProvider("key").models },
      { name: "google", format: "gemini", models: new GoogleImageProvider("key").models },
      { name: "google-vertex-image", format: "gemini", models: new GoogleVertexImageProvider({ project: "project", location: "global" }).models },
      { name: "replicate-image", format: "replicate", models: new ReplicateImageProvider("key").models },
      { name: "volces", format: "volces", models: new VolcesImageProvider("key").models },
      { name: "metaso-video", format: "", models: new MetasoVideoProvider("key").models },
      { name: "google-video", format: "", models: new GoogleVideoProvider("key").models },
      { name: "google-vertex-video", format: "", models: new GoogleVertexVideoProvider({ project: "project", location: "us-central1" }).models },
      { name: "replicate-video", format: "", models: new ReplicateVideoProvider("key").models },
    ];

    for (const catalog of catalogs) {
      for (const model of catalog.models) {
        const profile = getModelCallProfile(model.id, catalog.format);
        expect(profile.id, `${catalog.name}:${model.id}`).not.toBe("generic");
        expect(profile.requestAdapter, `${catalog.name}:${model.id}`).not.toBe("configured-template");
        expect(profile.responseAdapter, `${catalog.name}:${model.id}`).not.toBe("configured-response-paths");
      }
    }
  });

  it("validates model-specific input before a paid call", () => {
    const kling = getModelCallProfile("kwaivgi/kling-v3-video", "");
    expect(validateProfileInput(kling, { duration: 4 })).toContain("duration");
    expect(validateProfileInput(kling, { duration: 5, inputImageCount: 1, aspectRatio: "16:9", enableAudio: true })).toBeUndefined();
    const metaso = getModelCallProfile("metaso/minimax-h3", "");
    expect(validateProfileInput(metaso, { duration: 5, enableAudio: true })).toContain("audio");
  });
});
