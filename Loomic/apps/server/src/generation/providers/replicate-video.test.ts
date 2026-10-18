import { afterEach, describe, expect, it, vi } from "vitest";
import { ReplicateVideoProvider, buildReplicateVideoModelInput } from "./replicate-video.js";
import { getModelCallProfile } from "../../local-db/model-call-profiles.js";

const model = { id: "test", displayName: "test", description: "test", capabilities: { textToVideo: true, imageToVideo: true, videoToVideo: true, audio: true }, limits: { maxDuration: 15, allowedDurations: [4, 5, 6, 8, 10, 12, 15], maxResolution: "2160p" as const, maxInputImages: 7 } };

afterEach(() => vi.unstubAllGlobals());

describe("Replicate model input profiles", () => {
  it("rejects inline reference data before issuing a Replicate request", () => {
    expect(() => buildReplicateVideoModelInput({
      model: "kwaivgi/kling-v3-video",
      prompt: "x",
      inputImages: ["data:image/png;base64,cGlj"],
    }, model)).toThrow(/public HTTP\(S\) URLs/);
  });

  it("uses Kling start_image and audio-generation fields", () => {
    const out = buildReplicateVideoModelInput({ model: "kwaivgi/kling-v3-video", prompt: "x", duration: 5, inputImages: ["https://img.test/a.jpg"], enableAudio: true }, model);
    expect(out.endpoint).toBe("kwaivgi/kling-v3-video");
    expect(out.input).toMatchObject({ start_image: "https://img.test/a.jpg", generate_audio: true, duration: "5" });
  });

  it("switches Wan endpoint between T2V and I2V", () => {
    const t2v = buildReplicateVideoModelInput({ model: "wan-video/wan-2.6", prompt: "x" }, model);
    const i2v = buildReplicateVideoModelInput({ model: "wan-video/wan-2.6", prompt: "x", inputImages: ["https://img.test/a.jpg"] }, model);
    expect(t2v.endpoint).toBe("wan-video/wan-2.6-t2v");
    expect(i2v.endpoint).toBe("wan-video/wan-2.6-i2v");
    expect(i2v.input.image).toBe("https://img.test/a.jpg");
  });

  it("uses Seedance image and audio fields", () => {
    const out = buildReplicateVideoModelInput({ model: "bytedance/seedance-1.5-pro", prompt: "x", inputImages: ["https://img.test/a.jpg"] }, model);
    expect(out.input).toMatchObject({ image: "https://img.test/a.jpg", audio: true });
  });

  it("uses Sora image_url, aspect, resolution and duration fields", () => {
    const out = buildReplicateVideoModelInput({ model: "openai/sora-2", prompt: "x", duration: 8, resolution: "1080p", inputImages: ["https://img.test/a.jpg"] }, model);
    expect(out.input).toMatchObject({ image_url: "https://img.test/a.jpg", duration: 8, resolution: "1080p", aspect_ratio: "16:9" });
  });

  it("requires a video source for Kling O1 and maps it to input_video", () => {
    expect(() => buildReplicateVideoModelInput({ model: "kwaivgi/kling-o1", prompt: "edit" }, model)).toThrow(/requires inputVideo/);
    const out = buildReplicateVideoModelInput({ model: "kwaivgi/kling-o1", prompt: "edit", inputVideo: "https://video.test/source.mp4" }, model);
    expect(out.input).toMatchObject({ reference_video: "https://video.test/source.mp4", video_reference_type: "feature" });
  });

  it("preserves Omni reference images and video in the request", () => {
    const omni = new ReplicateVideoProvider("token").models.find((entry) => entry.id === "kwaivgi/kling-v3-omni-video")!;
    const out = buildReplicateVideoModelInput({
      model: omni.id,
      prompt: "camera orbit",
      duration: 10,
      resolution: "1080p",
      inputImages: ["https://img.test/first.png", "https://img.test/ref.png"],
      inputVideo: "https://video.test/source.mp4",
      enableAudio: true,
    }, omni);

    expect(out.input).toMatchObject({
      start_image: "https://img.test/first.png",
      reference_images: ["https://img.test/ref.png"],
      reference_video: "https://video.test/source.mp4",
      video_reference_type: "feature",
      mode: "pro",
      keep_original_sound: true,
      generate_audio: false,
    });
    expect(out.input).not.toHaveProperty("image_url");
  });

  it("uses exact per-variant Kling image limits", () => {
    const provider = new ReplicateVideoProvider("token");
    const v3 = provider.models.find((entry) => entry.id === "kwaivgi/kling-v3-video")!;
    const omni = provider.models.find((entry) => entry.id === "kwaivgi/kling-v3-omni-video")!;
    const oneImage = ["https://img.test/one.png"];

    expect(() => buildReplicateVideoModelInput({ model: v3.id, prompt: "x", inputImages: [...oneImage, ...oneImage] }, v3)).toThrow(/at most 1/);
    expect(() => buildReplicateVideoModelInput({ model: omni.id, prompt: "x", inputImages: Array.from({ length: 8 }, () => oneImage[0]!) }, omni)).toThrow(/at most 7/);
    expect(() => buildReplicateVideoModelInput({ model: omni.id, prompt: "x", inputImages: Array.from({ length: 5 }, () => oneImage[0]!), inputVideo: "https://video.test/source.mp4" }, omni)).toThrow(/at most 4/);
  });

  it("rejects capability mismatches before the Provider is called", () => {
    const textOnlyVeo = new ReplicateVideoProvider("token").models.find((entry) => entry.id === "google/veo-3")!;
    expect(() => buildReplicateVideoModelInput({ model: textOnlyVeo.id, prompt: "x", inputImages: ["https://img.test/a.png"] }, textOnlyVeo)).toThrow(/does not support image-to-video/);

    const silentHailuo = new ReplicateVideoProvider("token").models.find((entry) => entry.id === "minimax/hailuo-2.3")!;
    expect(() => buildReplicateVideoModelInput({ model: silentHailuo.id, prompt: "x", enableAudio: true }, silentHailuo)).toThrow(/does not support generated audio/);
  });

  it("keeps each published Replicate model profile compatible with its advertised limits", () => {
    for (const entry of new ReplicateVideoProvider("token").models) {
      const profile = getModelCallProfile(entry.id, "");
      expect(profile.id, entry.id).not.toBe("generic");
      for (const duration of entry.limits.allowedDurations ?? []) {
        const validInput = entry.id === "kwaivgi/kling-o1" ? { inputVideo: "https://video.test/source.mp4" } : {};
        expect(() => buildReplicateVideoModelInput({ model: entry.id, prompt: "x", duration, ...validInput }, entry)).not.toThrow();
      }
      if (entry.capabilities.audio) expect(profile.supportsAudio, entry.id).not.toBe(false);
    }
  });

  it("rejects unsupported aspect ratios and resolution before issuing a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ReplicateVideoProvider("token");

    await expect(provider.generate({ model: "kwaivgi/kling-v3-video", prompt: "x", duration: 5, aspectRatio: "4:3" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(provider.generate({ model: "kwaivgi/kling-v3-video", prompt: "x", duration: 5, resolution: "2160p" as "1080p" })).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the prediction request and parses a synchronous video result", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "pred-1", status: "succeeded", output: "https://cdn.test/video.mp4" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ReplicateVideoProvider("replicate-token");

    const video = await provider.generate({ model: "kwaivgi/kling-v3-video", prompt: "slow orbit", duration: 5, resolution: "1080p", inputImages: ["https://img.test/frame.png"] });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.replicate.com/v1/models/kwaivgi/kling-v3-video/predictions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer replicate-token");
    expect(new Headers(init?.headers).get("prefer")).toBe("wait=300");
    expect(JSON.parse(String(init?.body))).toMatchObject({ input: { start_image: "https://img.test/frame.png", duration: "5", mode: "pro" } });
    expect(video).toMatchObject({ url: "https://cdn.test/video.mp4", durationSeconds: 5, width: 1920, height: 1080 });
  });

  it("polls predictions returned in starting state and extracts array output", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pred-2", status: "starting", output: null, urls: { get: "https://api.replicate.com/v1/predictions/pred-2" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pred-2", status: "succeeded", output: ["https://cdn.test/polled.mp4"] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = new ReplicateVideoProvider("replicate-token").generate({ model: "bytedance/seedance-1.5-pro", prompt: "sunrise", duration: 5 });
    await vi.advanceTimersByTimeAsync(5000);
    const video = await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.replicate.com/v1/predictions/pred-2");
    expect(video.url).toBe("https://cdn.test/polled.mp4");
  });

  it("retries transient polling HTTP errors and reports cancellation", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pred-4", status: "processing", output: null, urls: { get: "https://api.replicate.com/v1/predictions/pred-4" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response("temporarily unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pred-4", status: "succeeded", output: "https://cdn.test/recovered.mp4" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = new ReplicateVideoProvider("replicate-token").generate({ model: "openai/sora-2", prompt: "x", duration: 4 });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toMatchObject({ url: "https://cdn.test/recovered.mp4" });

    const canceledFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ id: "pred-5", status: "canceled", output: null }), { status: 200 }));
    vi.stubGlobal("fetch", canceledFetch);
    await expect(new ReplicateVideoProvider("replicate-token").generate({ model: "openai/sora-2", prompt: "x", duration: 4 }))
      .rejects.toMatchObject({ code: "prediction_failed", message: "Video prediction failed: canceled" });
  });

  it("rejects non-JSON bodies for create and poll responses", async () => {
    const createFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("upstream html error", { status: 200 }));
    vi.stubGlobal("fetch", createFetch);
    await expect(new ReplicateVideoProvider("replicate-token").generate({ model: "openai/sora-2", prompt: "x", duration: 4 }))
      .rejects.toMatchObject({ code: "invalid_provider_response", message: expect.stringContaining("prediction creation") });

    vi.useFakeTimers();
    const pollFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pred-6", status: "processing", output: null, urls: { get: "https://api.replicate.com/v1/predictions/pred-6" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response("not json", { status: 200 }));
    vi.stubGlobal("fetch", pollFetch);
    const pending = new ReplicateVideoProvider("replicate-token").generate({ model: "openai/sora-2", prompt: "x", duration: 4 });
    const assertion = expect(pending).rejects.toMatchObject({ code: "invalid_provider_response", message: expect.stringContaining("prediction polling") });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("ends polling at the configured timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pred-7", status: "processing", output: null, urls: { get: "https://api.replicate.com/v1/predictions/pred-7" } }), { status: 200 }))
      .mockResolvedValue(new Response("still running", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = new ReplicateVideoProvider("replicate-token").generate({ model: "openai/sora-2", prompt: "x", duration: 4 });
    const assertion = expect(pending).rejects.toMatchObject({ code: "timeout", message: "Video generation timed out waiting for Replicate" });
    await vi.advanceTimersByTimeAsync(300_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(61);
  });

  it("surfaces HTTP and prediction-level errors without calling again", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "model unavailable" }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pred-3", status: "failed", output: null, error: "input image rejected" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ReplicateVideoProvider("replicate-token");

    await expect(provider.generate({ model: "openai/sora-2", prompt: "x", duration: 4 })).rejects.toMatchObject({ code: "api_error", message: "Replicate API error 404: model unavailable" });
    await expect(provider.generate({ model: "openai/sora-2", prompt: "x", duration: 4 })).rejects.toMatchObject({ code: "prediction_failed", message: "Video prediction failed: input image rejected" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
