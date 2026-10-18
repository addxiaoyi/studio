import { describe, expect, it } from "vitest";
import { buildFeedPrompt, getFeedDurations } from "@/lib/feed-workflow";

describe("getFeedDurations", () => {
  const models = [
    { id: "text-video", limits: { maxDuration: 15, allowedDurations: [4, 5, 6, 8, 10, 12, 15] } },
    { id: "short-video", limits: { maxDuration: 10, allowedDurations: [5, 10] } },
  ];

  it("shows the union supported by the automatic routing pool", () => {
    expect(getFeedDurations(models, "auto")).toEqual([4, 5, 6, 8, 10, 12, 15]);
  });

  it("shows only durations supported by a manually selected model", () => {
    expect(getFeedDurations(models, "short-video")).toEqual([5, 10]);
  });
});

describe("buildFeedPrompt", () => {
  it("builds one constrained generation workflow", () => {
    const prompt = buildFeedPrompt({ mode: "feed", platform: "抖音", goal: "直接转化", contentType: "种草转化", duration: 10, brief: "突出轻便" });
    expect(prompt).toContain("成片时长：10秒");
    expect(prompt).toContain("只生成一张商品首帧图片");
    expect(prompt).toContain("一条10秒短视频");
    expect(prompt).toContain("不得擅自生成多个版本");
  });

  it("keeps breakdown mode focused on structure rather than copying", () => {
    const prompt = buildFeedPrompt({ mode: "breakdown", platform: "小红书", goal: "种草蓄水", contentType: "使用场景", duration: 15, brief: "保温杯" });
    expect(prompt).toContain("只参考结构与节奏");
    expect(prompt).toContain("不复制原文案、人物或画面");
  });
});
