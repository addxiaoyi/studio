import { describe, expect, it, vi } from "vitest";
import { feedStructureSchema } from "@helstera/shared";
import { getExecutor } from "../job-executor.js";
import { executeFeedStructureJob } from "./feed-structure.js";

const packageId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";

const modelStructure = {
  title: "模型生成标题",
  audience: "正在寻找可靠解决方案的人",
  painPoint: "无法快速判断产品是否适合自己",
  angle: "从真实使用问题切入，再用证据说明价值",
  hypothesis: "先给结果再给证据更容易获得理解",
  hook: "三秒看懂这个产品解决什么问题",
  evidence: ["展示真实使用过程", "只使用已确认的商品信息"],
  cta: "查看详情",
  riskNotes: ["未核验参数不得写成事实"],
  imagePrompt: "真实商品首帧，主体清晰，光线自然",
  videoPrompt: "15秒短视频，先展示问题，再展示使用和证据，最后给出单一CTA",
  aspectRatio: "9:16",
  shots: [
    {
      id: "hook",
      startSecond: 0,
      endSecond: 3,
      visual: "近景展示问题和商品",
      voiceover: "三秒看懂这个产品解决什么问题",
      subtitle: "三秒看懂这个产品解决什么问题",
    },
    {
      id: "proof",
      startSecond: 3,
      endSecond: 12,
      visual: "展示真实使用过程和细节",
      voiceover: "用真实场景说明产品价值",
      subtitle: "真实场景说明产品价值",
    },
    {
      id: "cta",
      startSecond: 12,
      endSecond: 15,
      visual: "回到商品和行动指令",
      voiceover: "查看详情",
      subtitle: "查看详情",
    },
  ],
};

function makeContext(payload: Record<string, unknown>, packageStructure: Record<string, unknown> | null = null) {
  let saved: Record<string, unknown> | null = null;
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("from background_jobs")) return { rows: [{ payload }] };
    if (sql.includes("from content_packages")) {
      return {
        rows: [{
          id: packageId,
          workspace_id: workspaceId,
          title: "数据库标题",
          topic: "内容主题",
          brief: "解决日常使用中的真实问题",
          goal: "转化",
          content_type: "种草转化",
          platforms: ["douyin"],
          duration_seconds: 15,
          status: "draft",
          structure: packageStructure,
        }],
      };
    }
    if (sql.includes("update content_packages")) {
      saved = packageStructure;
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("insert into content_variants")) return { rowCount: 1, rows: [] };
    throw new Error("unexpected query: " + sql);
  });

  return {
    localDb: { query },
    saved: () => saved,
    jobService: {
      updateProgress: vi.fn(),
    },
    env: {
      agentModel: "openai:test-model",
      openAIApiBase: "https://example.test/v1",
      openAIApiKey: "test-key",
    },
  } as any;
}

function makePayload(existingStructure?: Record<string, unknown>) {
  return {
    feed_package_id: packageId,
    feed_workspace_id: workspaceId,
    title: "用户输入标题",
    brief: "解决日常使用中的真实问题",
    topic: "内容主题",
    goal: "转化",
    content_type: "种草转化",
    platforms: ["douyin"],
    duration_seconds: 15,
    ...(existingStructure ? { existing_structure: existingStructure } : {}),
  };
}

describe("feed structure executor", () => {
  it("registers the feed_structure worker executor", () => {
    expect(getExecutor("feed_structure" as any)).toBeTypeOf("function");
  });
  it("generates JSON, validates it, and preserves existing fields", async () => {
    const existing = {
      title: "用户确认标题",
      hook: "用户确认钩子",
      referenceImageUrls: ["/api/uploads/reference.png"],
    };
    const ctx = makeContext(makePayload(existing));
    const model = { invoke: vi.fn().mockResolvedValue({
      content: JSON.stringify(modelStructure),
      usage_metadata: { input_tokens: 120, output_tokens: 80 },
    }) };

    const output = await executeFeedStructureJob(
      jobId,
      {},
      ctx,
      { createModel: () => model as any },
    );

    expect(model.invoke).toHaveBeenCalledOnce();
    expect(output.structure).toMatchObject({
      title: "用户确认标题",
      hook: "用户确认钩子",
      referenceImageUrls: ["/api/uploads/reference.png"],
      audience: modelStructure.audience,
    });
    expect(feedStructureSchema.safeParse(output.structure).success).toBe(true);
    expect(output.usage).toEqual({ inputTokens: 120, outputTokens: 80 });
    expect(ctx.jobService.updateProgress).toHaveBeenCalledWith(jobId, 100, "结构化内容生成完成");
  });

  it("skips the paid model when the existing structure is already complete", async () => {
    const ctx = makeContext(makePayload(modelStructure), modelStructure);
    const createModel = vi.fn();

    const output = await executeFeedStructureJob(jobId, {}, ctx, { createModel });

    expect(createModel).not.toHaveBeenCalled();
    expect(output.model_skipped).toBe(true);
    expect(feedStructureSchema.safeParse(output.structure).success).toBe(true);
  });

  it("returns a clear error for malformed model JSON", async () => {
    const ctx = makeContext(makePayload({ title: "用户确认标题" }));
    const model = { invoke: vi.fn().mockResolvedValue({ content: "不是 JSON" }) };

    await expect(
      executeFeedStructureJob(jobId, {}, ctx, { createModel: () => model as any }),
    ).rejects.toMatchObject({
      code: "feed_structure_invalid_output",
      message: expect.stringContaining("有效 JSON"),
    });
  });

  it("rejects an invalid existing field instead of overwriting it", async () => {
    const ctx = makeContext(makePayload({ title: "", hook: "用户确认钩子" }));
    const model = { invoke: vi.fn() };

    await expect(
      executeFeedStructureJob(jobId, {}, ctx, { createModel: () => model as any }),
    ).rejects.toMatchObject({ code: "feed_structure_existing_invalid" });
    expect(model.invoke).not.toHaveBeenCalled();
  });
});
