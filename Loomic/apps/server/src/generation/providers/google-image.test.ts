import { GoogleGenAI } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { GoogleImageProvider } from "./google-image.js";
import { getModelCallProfile } from "../../local-db/model-call-profiles.js";

describe("Google Gemini image request contract", () => {
  it("maps every advertised Google image model to an explicit Gemini profile", () => {
    for (const model of new GoogleImageProvider("test-key").models) {
      const profile = getModelCallProfile(model.id, "gemini");
      expect(profile.id, model.id).toBe("gemini-image");
      expect(profile.requestAdapter, model.id).toBe("gemini-content-parts");
      expect(profile.responseAdapter, model.id).toBe("gemini-inline-image");
    }
  });

  it("builds Gemini multimodal request parts and decodes inline image output", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      candidates: [{ content: { parts: [{ text: "description" }, { inlineData: { mimeType: "image/png", data: "AQID" } }] } }],
    });
    const client = { models: { generateContent } } as unknown as Pick<GoogleGenAI, "models">;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([9, 8, 7]), { status: 200, headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GoogleImageProvider("test-key", client);

    const image = await provider.generate({
      model: "google-official/gemini-3-pro-image-preview",
      prompt: "edit the product",
      aspectRatio: "16:9",
      quality: "ultra",
      inputImages: ["https://assets.test/input.jpg"],
    });

    expect(generateContent).toHaveBeenCalledWith({
      model: "gemini-3-pro-image-preview",
      contents: [{ role: "user", parts: [
        { text: "edit the product" },
        { inlineData: { mimeType: "image/jpeg", data: "CQgH" } },
      ] }],
      config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "4K" } },
    });
    expect(image).toMatchObject({ url: "data:image/png;base64,AQID", mimeType: "image/png", width: 1024, height: 576 });
  });

  it("preserves safety refusal and missing-image response classifications", async () => {
    const makeProvider = (response: unknown) => new GoogleImageProvider("test-key", {
      models: { generateContent: vi.fn().mockResolvedValue(response) },
    } as unknown as Pick<GoogleGenAI, "models">);

    await expect(makeProvider({ promptFeedback: { blockReason: "SAFETY" } }).generate({ model: "google-official/gemini-2.5-flash-image", prompt: "x" }))
      .rejects.toMatchObject({ code: "safety_filter" });
    await expect(makeProvider({ candidates: [{ content: { parts: [{ text: "no image" }] } }] }).generate({ model: "google-official/gemini-2.5-flash-image", prompt: "x" }))
      .rejects.toMatchObject({ code: "no_output" });
  });

  it("classifies bad model ids, reference-image fetch failures, and SDK errors", async () => {
    const generateContent = vi.fn().mockRejectedValue(new Error("permission denied"));
    const provider = new GoogleImageProvider("test-key", { models: { generateContent } } as unknown as Pick<GoogleGenAI, "models">);
    await expect(provider.generate({ model: "unknown-image-model", prompt: "x" })).rejects.toMatchObject({ code: "model_not_found" });

    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("connection reset")));
    await expect(provider.generate({ model: "google-official/gemini-2.5-flash-image", prompt: "x", inputImages: ["https://assets.test/ref.jpg"] }))
      .rejects.toMatchObject({ code: "input_fetch_error" });
    expect(generateContent).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    await expect(provider.generate({ model: "google-official/gemini-2.5-flash-image", prompt: "x" }))
      .rejects.toMatchObject({ code: "api_error", message: expect.stringContaining("permission denied") });
  });
});
