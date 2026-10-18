import { createCipheriv, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConfiguredVideoRequest, classifyVideoProviderRejection, generateConfiguredVideo, generateConfiguredVideoOnce, providerResponseShape, readTaskId, readVideoUrl, videoPollDelayMs } from "./provider-generation.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function encryptedKey(value = "provider-key") {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  vi.stubEnv("PROVIDER_CONFIG_ENCRYPTION_KEY", key.toString("base64"));
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64");
}

describe("configured provider response adapters", () => {
  it("classifies provider business codes and nested messages", () => {
    expect(classifyVideoProviderRejection("402", "balance too low")).toBe("upstream_insufficient_balance");
    expect(classifyVideoProviderRejection("401", "invalid key")).toBe("provider_auth_failed");
    expect(classifyVideoProviderRejection("404", "model not found")).toBe("model_not_found");
    expect(classifyVideoProviderRejection("number", "content safety policy rejected")).toBe("safety_filter");
    expect(classifyVideoProviderRejection("number", "opaque upstream business error")).toBe("provider_request_failed");
  });

  it("extracts supported task and video URL shapes inside object data", () => {
    const response = { code: 200, data: { taskId: "task-42", result: { videoUrl: "https://cdn.example/video.mp4" } } };
    expect(readTaskId(response)).toBe("task-42");
    expect(readVideoUrl(response)).toBe("https://cdn.example/video.mp4");
    expect(providerResponseShape({ code: "number", data: { hit: "images" }, msg: "invalid request" })).toMatchObject({
      codeType: "string",
      code: "number",
      dataType: "object",
      dataKeys: ["hit"],
      hasMessage: true,
    });
  });

  it("accepts numeric zero as a successful provider code and reads task nesting", () => {
    const response = {
      code: 0,
      data: { task: { id: "task-43", status: "queued" } },
      msg: "success",
    };
    expect(readTaskId(response)).toBe("task-43");
    expect(classifyVideoProviderRejection(response.code, response.msg)).toBe("provider_request_failed");
  });
});

describe("buildConfiguredVideoRequest", () => {
  it("preserves a first frame when the provider template omitted images", () => {
    const request = buildConfiguredVideoRequest("minimax-h3", "lingke_media", {
      options: { duration: ["4", "5"], resolution: ["480p", "720p"] },
      defaults: { duration: "auto", resolution: "480p" },
      required: ["duration", "resolution"],
    }, {
      prompt: "test",
      duration: 4,
      resolution: "720p",
      aspectRatio: "9:16",
      inputImages: ["data:image/jpeg;base64,frame"],
    }) as { params: Record<string, unknown> };

    expect(request.params.images).toEqual(["data:image/jpeg;base64,frame"]);
    expect(request.params.input_images).toEqual(["data:image/jpeg;base64,frame"]);
    expect(request.params.first_frame).toBe("data:image/jpeg;base64,frame");
    expect(request.params.duration).toBe("4");
    expect(request.params.resolution).toBe("768P");
  });

  it("uses the configured default when no provider resolution was selected", () => {
    const request = buildConfiguredVideoRequest("minimax-h3", "lingke_media", {
      options: { duration: ["5"], resolution: ["480p", "720p", "1080p"] },
      defaults: { duration: "5", resolution: "480p" },
      required: ["duration", "images", "resolution"],
    }, { prompt: "test", duration: 5, inputImages: ["https://studio.example/frame.webp"] }) as { params: Record<string, unknown> };
    expect(request.params).toMatchObject({ duration: "5", resolution: "768P", images: ["https://studio.example/frame.webp"] });
  });

  it("uses native MiniMax resolution labels only when configured", () => {
    const request = buildConfiguredVideoRequest("minimax-h3", "lingke_media", {
      options: { duration: ["5"], resolution: ["768P", "2K"] },
      defaults: { duration: "5", resolution: "768P" },
      required: ["duration", "images", "resolution"],
    }, { prompt: "test", duration: 5, resolution: "1080p", inputImages: ["https://studio.example/frame.webp"] }) as { params: Record<string, unknown> };
    expect(request.params.resolution).toBe("2K");
  });

  it("keeps custom template URL and data-URI transport explicit", () => {
    const template = {
      model: "{{model}}",
      prompt: "{{prompt}}",
      input_images: "{{input_images}}",
      first_frame: "{{first_frame}}",
    };
    const publicUrl = "https://assets.example/frame.png";
    const inline = "data:image/png;base64,cGlj";

    const urlRequest = buildConfiguredVideoRequest("custom-video", "custom", template, {
      prompt: "animate",
      inputImages: [publicUrl],
    }) as Record<string, unknown>;
    const inlineRequest = buildConfiguredVideoRequest("custom-video", "custom", template, {
      prompt: "animate",
      inputImages: [inline],
    }) as Record<string, unknown>;

    expect(urlRequest).toMatchObject({
      input_images: JSON.stringify([publicUrl]),
      first_frame: publicUrl,
    });
    expect(inlineRequest).toMatchObject({
      input_images: JSON.stringify([inline]),
      first_frame: inline,
    });
  });
});

describe("configured video input validation", () => {
  it("rejects inline images before calling a public-URL Provider", async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [{ api_format: "lingke_media" }] }),
    };

    await expect(generateConfiguredVideo(db as unknown as Pool, "minimax-h3", {
      prompt: "animate this frame",
      duration: 5,
      inputImages: ["data:image/png;base64,Zmlyc3QtZnJhbWU="],
    })).rejects.toMatchObject({ code: "invalid_input", message: expect.stringContaining("public HTTP(S)") });

    expect(db.query).toHaveBeenCalledOnce();
  });
});

describe("configured video polling", () => {
  it("retries a transient 5xx poll and returns the later video URL", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "task-1" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response("upstream unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { video_url: "https://cdn.test/video.mp4" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const query = vi.fn().mockImplementation(async (sql: string) => sql.includes("select pc.id, pc.label")
      ? { rows: [{ id: "provider-1", provider_model_id: "model-1", label: "fixture", base_url: "https://provider.test", key_ciphertext: encryptedKey(), api_format: "custom", request_template: { prompt: "{{prompt}}", duration: "{{duration}}" }, response_template: {} }] }
      : { rows: [] });
    const pending = generateConfiguredVideoOnce({ query } as unknown as Pool, "fixture-video", { prompt: "orbit", duration: 5 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(pending).resolves.toMatchObject({ url: "https://cdn.test/video.mp4", durationSeconds: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://provider.test/videos/task-1");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://provider.test/videos/task-1");
  });

  it("stops on terminal provider failure without trying another poll", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "task-2" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { status: "failed", error: "safety rejected" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const query = vi.fn().mockImplementation(async (sql: string) => sql.includes("select pc.id, pc.label")
      ? { rows: [{ id: "provider-1", provider_model_id: "model-1", label: "fixture", base_url: "https://provider.test", key_ciphertext: encryptedKey(), api_format: "custom", request_template: { prompt: "{{prompt}}" }, response_template: {} }] }
      : { rows: [] });
    const pending = generateConfiguredVideoOnce({ query } as unknown as Pool, "fixture-video", { prompt: "orbit" });
    const assertion = expect(pending).rejects.toMatchObject({ code: "upstream_task_failed", message: expect.stringContaining("safety rejected") });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(2_000);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after the consecutive polling error limit with an accepted-task outcome", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "task-3" } }), { status: 200 }))
      .mockRejectedValue(new Error("poll connection reset"));
    vi.stubGlobal("fetch", fetchMock);
    const query = vi.fn().mockImplementation(async (sql: string) => sql.includes("select pc.id, pc.label")
      ? { rows: [{ id: "provider-1", provider_model_id: "model-1", label: "fixture", base_url: "https://provider.test", key_ciphertext: encryptedKey(), api_format: "custom", request_template: { prompt: "{{prompt}}" }, response_template: {} }] }
      : { rows: [] });
    const pending = generateConfiguredVideoOnce({ query } as unknown as Pool, "fixture-video", { prompt: "orbit" });
    const assertion = expect(pending).rejects.toMatchObject({ code: "upstream_task_accepted", message: expect.stringContaining("task-3") });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await vi.advanceTimersByTimeAsync(videoPollDelayMs(attempt));
    }
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(13);
  });

  it("classifies repeated poll timeouts separately from a generic accepted-task outcome", async () => {
    vi.useFakeTimers();
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task_id: "task-timeout" } }), { status: 200 }))
      .mockRejectedValue(timeout);
    vi.stubGlobal("fetch", fetchMock);
    const query = vi.fn().mockImplementation(async (sql: string) => sql.includes("select pc.id, pc.label")
      ? { rows: [{ id: "provider-1", provider_model_id: "model-1", label: "fixture", base_url: "https://provider.test", key_ciphertext: encryptedKey(), api_format: "custom", request_template: { prompt: "{{prompt}}" }, response_template: {} }] }
      : { rows: [] });
    const pending = generateConfiguredVideoOnce({ query } as unknown as Pool, "fixture-video", { prompt: "orbit" });
    const assertion = expect(pending).rejects.toMatchObject({ code: "upstream_poll_timeout", message: expect.stringContaining("task-timeout") });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await vi.advanceTimersByTimeAsync(videoPollDelayMs(attempt));
    }
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(13);
  });
});
