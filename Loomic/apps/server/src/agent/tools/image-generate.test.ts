import { describe, expect, it, vi } from "vitest";
import { createImageGenerateTool, runImageGenerate } from "./image-generate.js";

const input = { title: "商品主图", prompt: "一张背包商品主图", model: "gpt-image-2" };

describe("image job output", () => {
  it("preserves strict manual-model errors without retrying the job", async () => {
    const submit = vi.fn().mockRejectedValue(
      new Error("MODEL_SELECTION_REQUIRED:你已手动选择图片模型「gpt-image-2」，当前请求模型不可用。"),
    );
    const output = await runImageGenerate(input, undefined, submit);
    expect(output).toMatchObject({ errorCode: "model_selection_required" });
    expect(output.error).toContain("你已手动选择图片模型");
    expect(output.summary).toContain("你已手动选择图片模型");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("keeps accepted background work pending when agent polling ends", async () => {
    const submit = vi.fn().mockResolvedValue({ jobId: "accepted", pending: true });
    const output = await runImageGenerate(input, undefined, submit);
    expect(output).toMatchObject({ jobId: "accepted", pending: true, jobType: "image_generation" });
    expect(output.error).toBeUndefined();
    expect(output.imageUrl).toBeUndefined();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("preserves the selected workspace asset ID when resolving an attachment", async () => {
    const submit = vi.fn().mockResolvedValue({ jobId: "asset-job", pending: true });
    await runImageGenerate(
      { ...input, inputImages: ["asset-1"] },
      undefined,
      submit,
      { "asset-1": "data:image/png;base64,cGlj" },
    );

    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      inputImages: ["data:image/png;base64,cGlj"],
      inputAssetIds: ["asset-1"],
    });
  });
  it("rejects omitted tool prompts before any paid submission", async () => {
    const submit = vi.fn();
    const tool = createImageGenerateTool({ submitImageJob: submit, availableModels: [] });
    await expect(tool.invoke({} as never)).rejects.toThrow();
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not invent a reference-image instruction for a blank prompt", async () => {
    const submit = vi.fn();
    const output = await runImageGenerate({ ...input, prompt: "  " }, undefined, submit);
    expect(output.error).toContain("不能为空");
    expect(submit).not.toHaveBeenCalled();
  });

  it("rejects the retired SeedEdit model before submitting a paid job", async () => {
    const submit = vi.fn();
    const output = await runImageGenerate({ ...input, model: "doubao-seededit-3-0-i2i-250628" }, undefined, submit);
    expect(output).toMatchObject({ status: "job_failed", errorCode: "model_not_found", error: expect.stringContaining("retired") });
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(["google/imagen-4", "recraft-ai/recraft-v3"])(
    "rejects reference images for text-only model %s before submitting a paid job",
    async (model) => {
      const submit = vi.fn();
      const output = await runImageGenerate({ ...input, model, inputImages: ["https://assets.test/reference.png"] }, undefined, submit);
      expect(output).toMatchObject({ status: "job_failed", errorCode: "invalid_input", error: expect.stringContaining("reference-image") });
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it("passes the actual product and requested caption to the image job", async () => {
    const submit = vi.fn().mockResolvedValue({ jobId: "real-prompt", imageUrl: "https://example.com/mug.png" });
    const prompt = "仅一张白色陶瓷马克杯海报，文案：简洁日常";
    const tool = createImageGenerateTool({ submitImageJob: submit, availableModels: [] });
    await tool.invoke({ prompt, model: "gpt-image-2" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ prompt, model: "gpt-image-2" }));
  });

  it("does not emit another artifact for a reused successful job", async () => {
    const output = await runImageGenerate(input, undefined, async () => ({
      jobId: "existing", reused: true, imageUrl: "https://example.com/image.png", elementId: "existing-element",
    }));
    expect(output.imageUrl).toBeUndefined();
    expect(output.elementId).toBeUndefined();
    expect(output.jobId).toBeUndefined();
    expect(output.summary).toContain("不要再次生成");
  });

  it("keeps the task identity on the first successful result", async () => {
    const output = await runImageGenerate(input, undefined, async () => ({
      jobId: "first", imageUrl: "https://example.com/image.png",
    }));
    expect(output.jobId).toBe("first");
    expect(output.jobType).toBe("image_generation");
    expect(output.imageUrl).toBeTruthy();
  });
});
