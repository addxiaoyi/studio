import { afterEach, describe, expect, it, vi } from "vitest";
import { VolcesImageProvider } from "./volces-image.js";
import { getModelCallProfile } from "../../local-db/model-call-profiles.js";

afterEach(() => vi.unstubAllGlobals());

describe("Volces Ark image request contract", () => {
  it("matches the provider catalog to its Ark profile", () => {
    const provider = new VolcesImageProvider("key");
    expect(provider.models.map((model) => model.id)).toEqual(["doubao-seedream-3-0-t2i-250415"]);
    for (const model of provider.models) {
      expect(getModelCallProfile(model.id, "volces")).toMatchObject({
        id: "volces-image",
        requestAdapter: "volces-ark-images-generations",
        responseAdapter: "volces-url-or-b64-json",
      });
    }
  });

  it("sends Ark Bearer request shape and parses a URL image result", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [{ url: "https://cdn.test/seedream.png" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new VolcesImageProvider("ark-key", "https://ark.example/api/v3/");

    const image = await provider.generate({ model: "doubao-seedream-3-0-t2i-250415", prompt: "paper lantern", aspectRatio: "16:9" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://ark.example/api/v3/images/generations");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ark-key");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "doubao-seedream-3-0-t2i-250415",
      prompt: "paper lantern",
      size: "1024x576",
      n: 1,
      response_format: "url",
    });
    expect(image).toMatchObject({ url: "https://cdn.test/seedream.png", mimeType: "image/png", width: 1024, height: 576 });
  });

  it("parses base64 results, rejects malformed success and maps upstream HTTP errors", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: "AQID" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new VolcesImageProvider("key", "https://ark.example/api/v3");

    await expect(provider.generate({ model: "doubao-seedream-3-0-t2i-250415", prompt: "x" }))
      .resolves.toMatchObject({ url: "data:image/png;base64,AQID", mimeType: "image/png" });
    await expect(provider.generate({ model: "doubao-seedream-3-0-t2i-250415", prompt: "x" }))
      .rejects.toMatchObject({ code: "no_output" });
    await expect(provider.generate({ model: "doubao-seedream-3-0-t2i-250415", prompt: "x" }))
      .rejects.toMatchObject({ code: "api_error", message: "Volces API error 429: quota exceeded" });
  });

  it("keeps 401 and 403 provider errors distinct from successful-response parsing", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "forbidden model" } }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new VolcesImageProvider("key");

    await expect(provider.generate({ model: "doubao-seedream-3-0-t2i-250415", prompt: "x" }))
      .rejects.toMatchObject({ code: "api_error", message: "Volces API error 401: invalid api key" });
    await expect(provider.generate({ model: "doubao-seedream-3-0-t2i-250415", prompt: "x" }))
      .rejects.toMatchObject({ code: "api_error", message: "Volces API error 403: forbidden model" });
  });

  it("classifies non-JSON and malformed 2xx responses without leaking a TypeError", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("gateway html", { status: 502 }))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { url: "not-an-array" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new VolcesImageProvider("key");

    await expect(provider.generate({ model: "doubao-seedream-3-0-t2i-250415", prompt: "x" }))
      .rejects.toMatchObject({ code: "api_error", message: "Volces API error 502: Unknown error" });
    await expect(provider.generate({ model: "doubao-seedream-3-0-t2i-250415", prompt: "x" }))
      .rejects.toMatchObject({ code: "invalid_provider_response" });
    await expect(provider.generate({ model: "doubao-seedream-3-0-t2i-250415", prompt: "x" }))
      .rejects.toMatchObject({ code: "invalid_provider_response" });
  });

  it("rejects unsupported reference-image editing before making an upstream call", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new VolcesImageProvider("key");

    await expect(provider.generate({ model: "doubao-seedream-3-0-t2i-250415", prompt: "edit", inputImages: ["https://img.test/ref.png"] }))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
