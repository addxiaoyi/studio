import { afterEach, describe, expect, it, vi } from "vitest";
import { ReplicateImageProvider } from "./replicate-image.js";

afterEach(() => vi.unstubAllGlobals());

describe("Replicate image HTTP contract", () => {
  it("sends the model-specific payload and parses a successful output", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: "succeeded", output: ["https://cdn.example/out.png"] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const generated = await new ReplicateImageProvider("replicate-secret").generate({
      model: "openai/gpt-image-1",
      prompt: "product photo",
      aspectRatio: "16:9",
      inputImages: ["https://cdn.example/in.png"],
      quality: "hd",
      outputFormat: "png",
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.replicate.com/v1/models/openai/gpt-image-1/predictions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer replicate-secret");
    expect(new Headers(init?.headers).get("prefer")).toBe("wait");
    expect(JSON.parse(String(init?.body))).toEqual({ input: {
      prompt: "product photo",
      aspect_ratio: "3:2",
      input_images: ["https://cdn.example/in.png"],
      quality: "high",
      output_format: "png",
    } });
    expect(generated).toMatchObject({ url: "https://cdn.example/out.png", mimeType: "image/png" });
  });

  it("surfaces provider HTTP errors with status and detail", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ detail: "Invalid input image" }), { status: 422 })));
    const provider = new ReplicateImageProvider("token");

    await expect(provider.generate({ model: "google/nano-banana", prompt: "edit" })).rejects.toMatchObject({
      provider: "replicate",
      code: "api_error",
      message: "Replicate API error 422: Invalid input image",
    });
  });

  it("classifies non-JSON, non-object, and missing-output responses without a runtime TypeError", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(["not", "an", "object"]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "succeeded" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ReplicateImageProvider("token");

    await expect(provider.generate({ model: "google/nano-banana", prompt: "x" })).rejects.toMatchObject({ provider: "replicate", code: "invalid_provider_response" });
    await expect(provider.generate({ model: "google/nano-banana", prompt: "x" })).rejects.toMatchObject({ provider: "replicate", code: "invalid_provider_response" });
    await expect(provider.generate({ model: "google/nano-banana", prompt: "x" })).rejects.toMatchObject({ provider: "replicate", code: "no_output" });
  });
});
