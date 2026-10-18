import { GoogleGenAI } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleVertexImageProvider } from "./google-vertex-image.js";
import { getModelCallProfile } from "../../local-db/model-call-profiles.js";

afterEach(() => vi.useRealTimers());

describe("Google Vertex image request contract", () => {
  it("maps every advertised Vertex image model to the Gemini image profile", () => {
    const provider = new GoogleVertexImageProvider({ project: "project", location: "global" }, { models: { generateContent: vi.fn() } } as unknown as Pick<GoogleGenAI, "models">);
    for (const model of provider.models) {
      expect(getModelCallProfile(model.id, "gemini"), model.id).toMatchObject({
        id: "gemini-image",
        requestAdapter: "gemini-content-parts",
        responseAdapter: "gemini-inline-image",
      });
    }
  });

  it("sends Vertex model and image parts and returns inline image data", async () => {
    const generateContent = vi.fn().mockResolvedValue({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AQID" } }] } }] });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([3, 2, 1]), { status: 200, headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GoogleVertexImageProvider({ project: "project", location: "us-central1" }, { models: { generateContent } } as unknown as Pick<GoogleGenAI, "models">);

    const image = await provider.generate({ model: "google-vertex/gemini-3-pro-image-preview", prompt: "edit", aspectRatio: "9:16", quality: "ultra", inputImages: ["https://assets.test/ref.jpg"] });

    expect(generateContent).toHaveBeenCalledWith({
      model: "gemini-3-pro-image-preview",
      contents: [{ role: "user", parts: [{ text: "edit" }, { inlineData: { mimeType: "image/jpeg", data: "AwIB" } }] }],
      config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16", imageSize: "4K" } },
    });
    expect(image).toMatchObject({ url: "data:image/png;base64,AQID", mimeType: "image/png", width: 576, height: 1024 });
  });

  it("classifies Vertex safety, empty output, and unknown model errors", async () => {
    const client = (response: unknown) => ({ models: { generateContent: vi.fn().mockResolvedValue(response) } } as unknown as Pick<GoogleGenAI, "models">);
    const safety = new GoogleVertexImageProvider({ project: "p", location: "global" }, client({ promptFeedback: { blockReason: "SAFETY" } }));
    await expect(safety.generate({ model: "google-vertex/gemini-2.5-flash-image", prompt: "x" })).rejects.toMatchObject({ code: "safety_filter" });
    const empty = new GoogleVertexImageProvider({ project: "p", location: "global" }, client({ candidates: [{ content: { parts: [{ text: "none" }] } }] }));
    await expect(empty.generate({ model: "google-vertex/gemini-2.5-flash-image", prompt: "x" })).rejects.toMatchObject({ code: "no_output" });
    const unknown = new GoogleVertexImageProvider({ project: "p", location: "global" }, client({}));
    await expect(unknown.generate({ model: "google-vertex/unknown", prompt: "x" })).rejects.toMatchObject({ code: "model_not_found" });
  });

  it("times out a stalled Vertex image request", async () => {
    vi.useFakeTimers();
    const generateContent = vi.fn().mockImplementation(() => new Promise(() => undefined));
    const provider = new GoogleVertexImageProvider({ project: "p", location: "global" }, { models: { generateContent } } as unknown as Pick<GoogleGenAI, "models">);
    const pending = provider.generate({ model: "google-vertex/gemini-2.5-flash-image", prompt: "x" });
    const assertion = expect(pending).rejects.toMatchObject({ code: "api_error", message: expect.stringContaining("timed out after 120s") });
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
  });
});
