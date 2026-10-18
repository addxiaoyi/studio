import { afterEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_VIDEO_CAPABILITIES, GOOGLE_VIDEO_MODEL_MAP, GoogleVideoProvider, googleVideoResolutionToDimensions } from "./google-video.js";
import { GOOGLE_VERTEX_VIDEO_CAPABILITIES, GOOGLE_VERTEX_VIDEO_MODEL_MAP, GoogleVertexVideoProvider, googleVertexVideoResolutionToDimensions } from "./google-vertex-video.js";

afterEach(() => vi.unstubAllGlobals());

describe("Google Veo call contracts", () => {
  it("maps Developer model IDs to their API names and capabilities", () => {
    const apiModel = GOOGLE_VIDEO_MODEL_MAP["google-official/veo-2.0-generate-001"]!;
    expect(apiModel).toBe("veo-2.0-generate-001");
    expect(GOOGLE_VIDEO_CAPABILITIES[apiModel]?.allowedDurations).toEqual([5, 6, 7, 8]);
    expect(googleVideoResolutionToDimensions("720p", "9:16")).toEqual({ width: 720, height: 1280 });
  });

  it("keeps Vertex model mapping and dimensions separate", () => {
    const apiModel = GOOGLE_VERTEX_VIDEO_MODEL_MAP["google-vertex/veo-3.1-lite-generate-001"]!;
    expect(apiModel).toBe("veo-3.1-lite-generate-001");
    expect(GOOGLE_VERTEX_VIDEO_CAPABILITIES[apiModel]?.allowedResolutions).toEqual(["720p", "1080p"]);
    expect(googleVertexVideoResolutionToDimensions("1080p", "16:9")).toEqual({ width: 1920, height: 1080 });
  });

  it("sends Developer API image input and polls the operation to a downloadable URI", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } })));
    const generateVideos = vi.fn().mockResolvedValue({ name: "operations/op-1", done: false });
    const getVideosOperation = vi.fn().mockResolvedValue({ done: true, response: { generatedVideos: [{ video: { uri: "https://generativelanguage.googleapis.com/video.mp4", mimeType: "video/mp4" } }] } });
    const provider = new GoogleVideoProvider("google-key", { models: { generateVideos }, operations: { getVideosOperation } } as never);
    const pending = provider.generate({ model: "google-official/veo-3.1-generate-preview", prompt: "animate", duration: 6, resolution: "1080p", inputImages: ["https://assets.test/frame.png"] });

    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(generateVideos).toHaveBeenCalledWith(expect.objectContaining({
      model: "veo-3.1-generate-preview",
      prompt: "animate",
      image: { imageBytes: "AQID", mimeType: "image/png" },
      config: expect.objectContaining({ durationSeconds: 6, resolution: "1080p", aspectRatio: "16:9" }),
    }));
    expect(getVideosOperation).toHaveBeenCalledWith({ operation: { name: "operations/op-1", done: false } });
    expect(result.url).toBe("https://generativelanguage.googleapis.com/video.mp4?key=google-key");
    expect(result).toMatchObject({ width: 1920, height: 1080, mimeType: "video/mp4" });
  });

  it("classifies Developer API safety and operation failures", async () => {
    const safetyProvider = new GoogleVideoProvider("key", { models: { generateVideos: vi.fn().mockResolvedValue({ done: true, response: { raiMediaFilteredReasons: ["PERSON"] } }) }, operations: { getVideosOperation: vi.fn() } } as never);
    await expect(safetyProvider.generate({ model: "google-official/veo-3.0-generate-001", prompt: "x" })).rejects.toMatchObject({ code: "safety_filter" });

    const failedProvider = new GoogleVideoProvider("key", { models: { generateVideos: vi.fn().mockResolvedValue({ done: true, error: { code: 400, message: "rejected" } }) }, operations: { getVideosOperation: vi.fn() } } as never);
    await expect(failedProvider.generate({ model: "google-official/veo-3.0-generate-001", prompt: "x" })).rejects.toMatchObject({ code: "api_error" });
  });

  it("maps Developer API poll errors and times out stalled operations", async () => {
    vi.useFakeTimers();
    const pollFailure = new GoogleVideoProvider("key", {
      models: { generateVideos: vi.fn().mockResolvedValue({ done: false }) },
      operations: { getVideosOperation: vi.fn().mockRejectedValue(new Error("poll transport down")) },
    } as never);
    const failedPoll = pollFailure.generate({ model: "google-official/veo-3.0-generate-001", prompt: "x" });
    const failedPollAssertion = expect(failedPoll).rejects.toMatchObject({ code: "api_error", message: "Video generation status check failed. Please try again." });
    await vi.advanceTimersByTimeAsync(10_000);
    await failedPollAssertion;

    const getVideosOperation = vi.fn().mockResolvedValue({ done: false });
    const stalled = new GoogleVideoProvider("key", { models: { generateVideos: vi.fn().mockResolvedValue({ done: false }) }, operations: { getVideosOperation } } as never);
    const pending = stalled.generate({ model: "google-official/veo-3.0-generate-001", prompt: "x" });
    const timeoutAssertion = expect(pending).rejects.toMatchObject({ code: "timeout", message: "Video generation timed out after 300s" });
    await vi.advanceTimersByTimeAsync(310_000);
    await timeoutAssertion;
    expect(getVideosOperation).toHaveBeenCalledTimes(30);
  });

  it("returns Vertex inline video bytes and uses injected credentials for URI responses", async () => {
    const inlineClient = { models: { generateVideos: vi.fn().mockResolvedValue({ done: true, response: { generatedVideos: [{ video: { videoBytes: "AQID", mimeType: "video/mp4" } }] } }) }, operations: { getVideosOperation: vi.fn() } };
    const inlineProvider = new GoogleVertexVideoProvider({ project: "p", location: "us-central1" }, { client: inlineClient as never, auth: { getClient: vi.fn() } as never });
    await expect(inlineProvider.generate({ model: "google-vertex/veo-3.1-generate-001", prompt: "x", resolution: "1080p" }))
      .resolves.toMatchObject({ url: "data:video/mp4;base64,AQID", width: 1920, height: 1080 });

    const uriClient = { models: { generateVideos: vi.fn().mockResolvedValue({ done: true, response: { generatedVideos: [{ video: { uri: "https://vertex.test/output.mp4" } }] } }) }, operations: { getVideosOperation: vi.fn() } };
    const getAccessToken = vi.fn().mockResolvedValue({ token: "vertex-token" });
    const uriProvider = new GoogleVertexVideoProvider({ project: "p", location: "us-central1" }, { client: uriClient as never, auth: { getClient: vi.fn().mockResolvedValue({ getAccessToken }) } as never });
    await expect(uriProvider.generate({ model: "google-vertex/veo-3.1-generate-001", prompt: "x" }))
      .resolves.toMatchObject({ url: "https://vertex.test/output.mp4?access_token=vertex-token" });
    expect(getAccessToken).toHaveBeenCalledOnce();
  });

  it("fails clearly when Vertex polling or download authentication fails", async () => {
    vi.useFakeTimers();
    const pollProvider = new GoogleVertexVideoProvider({ project: "p", location: "us-central1" }, {
      client: { models: { generateVideos: vi.fn().mockResolvedValue({ done: false }) }, operations: { getVideosOperation: vi.fn().mockRejectedValue(new Error("poll failed")) } } as never,
      auth: { getClient: vi.fn() } as never,
    });
    const pollPending = pollProvider.generate({ model: "google-vertex/veo-3.1-generate-001", prompt: "x" });
    const pollAssertion = expect(pollPending).rejects.toMatchObject({ code: "api_error", message: "Video generation status check failed. Please try again." });
    await vi.advanceTimersByTimeAsync(10_000);
    await pollAssertion;

    const stalledProvider = new GoogleVertexVideoProvider({ project: "p", location: "us-central1" }, {
      client: { models: { generateVideos: vi.fn().mockResolvedValue({ done: false }) }, operations: { getVideosOperation: vi.fn().mockResolvedValue({ done: false }) } } as never,
      auth: { getClient: vi.fn() } as never,
    });
    const stalledPending = stalledProvider.generate({ model: "google-vertex/veo-3.1-generate-001", prompt: "x" });
    const timeoutAssertion = expect(stalledPending).rejects.toMatchObject({ code: "timeout", message: "Video generation timed out after 300s" });
    await vi.advanceTimersByTimeAsync(310_000);
    await timeoutAssertion;

    const authFailureProvider = new GoogleVertexVideoProvider({ project: "p", location: "us-central1" }, {
      client: { models: { generateVideos: vi.fn().mockResolvedValue({ done: true, response: { generatedVideos: [{ video: { uri: "https://vertex.test/output.mp4" } }] } }) }, operations: { getVideosOperation: vi.fn() } } as never,
      auth: { getClient: vi.fn().mockRejectedValue(new Error("credential unavailable")) } as never,
    });
    await expect(authFailureProvider.generate({ model: "google-vertex/veo-3.1-generate-001", prompt: "x" }))
      .rejects.toMatchObject({ code: "download_auth_failed" });
  });
});
