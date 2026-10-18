import { createAgent, FakeToolCallingModel, ToolMessage, tool } from "langchain";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { imageInputMiddleware } from "./image-input-middleware.js";
import { singleImageSubmission } from "./image-submission.js";
import { createImageGenerateTool } from "./tools/image-generate.js";

describe("image input isolation", () => {
  it("keeps one valid generation alive alongside two invalid parallel calls", async () => {
    const submit = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { jobId: "accepted", imageUrl: "https://example.com/mug.png" };
    });
    const model = new FakeToolCallingModel({ toolCalls: [[
      { name: "generate_image", id: "valid", args: { prompt: "一张白色马克杯，文案：简洁日常", model: "gpt-image-2" } },
      { name: "generate_image", id: "missing", args: { model: "gpt-image-2" } },
      { name: "generate_image", id: "blank", args: { prompt: " " } },
    ], []] });
    const agent = createAgent({ model, middleware: [imageInputMiddleware], tools: [
      createImageGenerateTool({ availableModels: [], submitImageJob: singleImageSubmission(submit) }),
    ] });
    const state = await agent.invoke({ messages: [{ role: "user", content: "一张马克杯海报" }] });
    const replies = state.messages.filter(ToolMessage.isInstance);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(replies).toHaveLength(3);
    expect(JSON.parse(String(replies.find((reply) => reply.tool_call_id === "valid")?.content))).toMatchObject({ jobId: "accepted", imageUrl: "https://example.com/mug.png" });
    expect(replies.filter((reply) => reply.status === "error")).toHaveLength(2);
  });

  it("submits nothing when all arguments are invalid, then accepts a corrected call", async () => {
    const submit = vi.fn().mockResolvedValue({ jobId: "corrected" });
    const model = new FakeToolCallingModel({ toolCalls: [
      [{ name: "generate_image", id: "invalid", args: { prompt: "mug", inputImages: "not-an-array" } }],
      [{ name: "generate_image", id: "corrected", args: { prompt: "mug" } }], [],
    ] });
    const agent = createAgent({ model, middleware: [imageInputMiddleware], tools: [
      createImageGenerateTool({ availableModels: [], submitImageJob: singleImageSubmission(submit) }),
    ] });
    const state = await agent.invoke({ messages: [{ role: "user", content: "mug" }] });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(state.messages.filter(ToolMessage.isInstance).map((reply) => reply.status)).toEqual(["error", "success"]);
  });

  it("does not suppress unrelated tool failures", async () => {
    const broken = tool(async () => { throw new Error("storage unavailable"); }, { name: "inspect_canvas", description: "test", schema: z.object({}) });
    const model = new FakeToolCallingModel({ toolCalls: [[{ name: "inspect_canvas", id: "other", args: {} }]] });
    const agent = createAgent({ model, middleware: [imageInputMiddleware], tools: [broken] });
    await expect(agent.invoke({ messages: [{ role: "user", content: "inspect" }] })).rejects.toThrow("storage unavailable");
  });
});
