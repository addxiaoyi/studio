import { describe, expect, it, vi } from "vitest";

import type { AvailableVideoModel } from "../../generation/providers/registry.js";
import { type SubmitVideoJobFn, runVideoGenerate } from "./video-generate.js";

const metasoModel: AvailableVideoModel = {
  id: "metaso/minimax-h3",
  displayName: "MiniMax H3 (Metaso)",
  description: "Metaso H3",
  provider: "metaso",
  capabilities: {
    textToVideo: true,
    imageToVideo: true,
    videoToVideo: false,
    audio: false,
  },
  limits: {
    maxDuration: 15,
    allowedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    maxResolution: "1080p",
    maxInputImages: 2,
  },
};

function input(
  overrides: Partial<Parameters<typeof runVideoGenerate>[0]> = {},
): Parameters<typeof runVideoGenerate>[0] {
  return {
    title: "Test video",
    prompt: "A paper crane takes flight",
    model: metasoModel.id,
    duration: 5,
    resolution: "720p",
    aspectRatio: "16:9",
    enableAudio: true,
    ...overrides,
  };
}

describe("runVideoGenerate capability enforcement", () => {
  it("does not send the schema's audio default to a model without audio capability", async () => {
    const submit = vi.fn<SubmitVideoJobFn>().mockResolvedValue({
      jobId: "job-1",
      videoUrl: "https://cdn.example/video.mp4",
      width: 1365,
      height: 768,
      durationSeconds: 5,
      mimeType: "video/mp4",
    });

    await runVideoGenerate(input(), submit, [metasoModel]);

    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]?.[0]).not.toHaveProperty("enableAudio");
  });

  it("rejects unsupported reference video and excess images before job submission", async () => {
    const submit = vi.fn<SubmitVideoJobFn>();

    const videoResult = await runVideoGenerate(
      input({ inputVideo: "https://cdn.example/source.mp4" }),
      submit,
      [metasoModel],
    );
    const imageResult = await runVideoGenerate(
      input({
        inputImages: [
          "https://cdn.example/1.png",
          "https://cdn.example/2.png",
          "https://cdn.example/3.png",
        ],
      }),
      submit,
      [metasoModel],
    );

    expect(videoResult).toMatchObject({ error: expect.stringContaining("reference-video"), errorCode: "invalid_input" });
    expect(imageResult).toMatchObject({ error: expect.stringContaining("at most 2"), errorCode: "invalid_input" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps audio disabled for an unlisted silent model", async () => {
    const submit = vi.fn<SubmitVideoJobFn>().mockResolvedValue({
      jobId: "job-silent",
      pending: true,
    });

    const output = await runVideoGenerate(
      input({ model: "minimax-h3", enableAudio: false }),
      submit,
      [],
    );

    expect(output).toMatchObject({ jobId: "job-silent", pending: true });
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]?.[0]).not.toHaveProperty("enableAudio");
  });

  it("uses the first uploaded attachment as the first frame", async () => {
    const submit = vi.fn<SubmitVideoJobFn>().mockResolvedValue({
      jobId: "job-2",
      videoUrl: "https://cdn.example/video.mp4",
      width: 1365,
      height: 768,
      durationSeconds: 5,
      mimeType: "video/mp4",
    });

    await runVideoGenerate(
      input(),
      submit,
      [metasoModel],
      { "asset-1": "data:image/png;base64,Zmlyc3QtZnJhbWU=" },
    );

    expect(submit.mock.calls[0]?.[0].inputImages).toEqual([
      "data:image/png;base64,Zmlyc3QtZnJhbWU=",
    ]);
    expect(submit.mock.calls[0]?.[0].inputAssetIds).toEqual(["asset-1"]);
  });

  it("keeps an accepted video job pending when agent polling ends", async () => {
    const submit = vi.fn<SubmitVideoJobFn>().mockResolvedValue({
      jobId: "job-pending",
      pending: true,
    });

    const output = await runVideoGenerate(input(), submit, [metasoModel]);

    expect(output).toMatchObject({
      jobId: "job-pending",
      jobType: "video_generation",
      pending: true,
    });
    expect(output.error).toBeUndefined();
  });

  it("rejects unsupported Profile input before submitting an unlisted configured model", async () => {
    const submit = vi.fn<SubmitVideoJobFn>();
    const output = await runVideoGenerate(input({ model: "minimax-h3", duration: 3 }), submit, []);
    expect(output.status).toBe("job_failed");
    expect(output.error).toContain("duration");
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(["gk-video-3", "grok-imagine-video-1.5-preview", "high_aes_general_v30l_zt2i"])(
    "rejects retired dynamic model %s before job submission",
    async (model) => {
      const submit = vi.fn<SubmitVideoJobFn>();
      const output = await runVideoGenerate(input({ model }), submit, []);
      expect(output).toMatchObject({ status: "job_failed", errorCode: "model_not_found" });
      expect(output.error).toContain("retired");
      expect(submit).not.toHaveBeenCalled();
    },
  );
});
