import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { OpenAIImageProvider } from "./openai-image.js";

describe("official OpenAI image request contract", () => {
  it("sends native auto-size parameters and decodes GPT Image base64 output", async () => {
    const generate = vi.fn().mockResolvedValue({ data: [{ b64_json: "AQID" }] });
    const client = { images: { generate } } as unknown as Pick<OpenAI, "images">;
    const provider = new OpenAIImageProvider("test-key", undefined, client);

    const image = await provider.generate({ model: "gpt-image-1", prompt: "a red cube", aspectRatio: "16:9", quality: "hd" });

    expect(generate).toHaveBeenCalledWith({ model: "gpt-image-1", prompt: "a red cube", size: "auto", n: 1 });
    expect(image).toMatchObject({ url: "data:image/png;base64,AQID", mimeType: "image/png", width: 1024, height: 576 });
  });

  it("maps DALL-E 3 quality to supported landscape dimensions and returns URL output", async () => {
    const generate = vi.fn().mockResolvedValue({ data: [{ url: "https://images.test/dalle.png" }] });
    const provider = new OpenAIImageProvider("test-key", undefined, { images: { generate } } as unknown as Pick<OpenAI, "images">);

    const image = await provider.generate({ model: "dall-e-3", prompt: "mountain lake", quality: "ultra" });

    expect(generate).toHaveBeenCalledWith({ model: "dall-e-3", prompt: "mountain lake", size: "1792x1024", n: 1 });
    expect(image).toMatchObject({ url: "https://images.test/dalle.png", mimeType: "image/png" });
  });

  it("turns an empty SDK response into a classified no-output error", async () => {
    const provider = new OpenAIImageProvider("test-key", undefined, { images: { generate: vi.fn().mockResolvedValue({ data: [] }) } } as unknown as Pick<OpenAI, "images">);

    await expect(provider.generate({ model: "gpt-image-2", prompt: "empty" })).rejects.toMatchObject({ provider: "openai", code: "no_output" });
  });
});
