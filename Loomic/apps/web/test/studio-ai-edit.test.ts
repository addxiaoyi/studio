import { afterEach, expect, it, vi } from "vitest";
import { buildStudioAiPlan, confirmStudioPlan, normalizeModelPlan, requestStudioAiPlan } from "@/lib/studio-ai-edit";

afterEach(() => vi.unstubAllGlobals());

const snapshot = { compositionId: "MyComp", revision: "a".repeat(64), duration: 2, format: "landscape" as const, captions: [], cut: null };
const commands = { summary: "字幕", actions: [{ type: "caption" as const, text: "标题", startMs: 0, endMs: 1000 }] };
const approval = { id: "123e4567-e89b-42d3-a456-426614174000", fingerprint: "b".repeat(64), expiresAt: "2099-01-01T00:00:00Z", estimatedCredits: 0 as const };
const approvedPlan = () => ({ ...normalizeModelPlan(commands, snapshot), approval });

it("does not send incomplete or extra action approvals", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(confirmStudioPlan("token", approvedPlan(), new Set())).rejects.toThrow("逐项确认");
  await expect(confirmStudioPlan("token", approvedPlan(), new Set([0, 1]))).rejects.toThrow("逐项确认");
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects a confirmation response for another composition or changed actions", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ id: approval.id, compositionId: "Other", plan: commands }));
  vi.stubGlobal("fetch", fetch);
  await expect(confirmStudioPlan("token", approvedPlan(), new Set([0]))).rejects.toThrow("确认");
  fetch.mockResolvedValue(Response.json({ id: approval.id, compositionId: "MyComp", plan: { ...commands, actions: [{ ...commands.actions[0], text: "被修改" }] } }));
  await expect(confirmStudioPlan("token", approvedPlan(), new Set([0]))).rejects.toThrow("确认");
});

it("shows a localized timeout without applying any edit", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("signal timed out", "TimeoutError")));
  await expect(requestStudioAiPlan("token", { prompt: "字幕", projectId: "MyComp", media: [] }, snapshot)).rejects.toThrow("超时");
});

const media = [
  { name: "recording.webm", mimeType: "video/webm" },
  { name: "intro.mp4", mimeType: "video/mp4" },
];

it("builds a confirmed-safe portrait cut from the current project media", () => {
  const plan = buildStudioAiPlan("把录屏剪成 30 秒竖屏视频，加字幕并导出", media, new Map([
    ["recording.webm", 18],
    ["intro.mp4", 20],
  ]));

  expect(plan.cut.format).toBe("portrait");
  expect(plan.cut.clips.map((clip) => clip.name)).toEqual(["recording.webm", "intro.mp4"]);
  expect(plan.cut.clips[1]?.end).toBe(12);
  expect(plan.actions).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: "生成字幕", status: "planned" }),
    expect.objectContaining({ label: "导出视频", status: "planned" }),
  ]));
});

it("rejects a plan when the editor has no video media", () => {
  expect(() => buildStudioAiPlan("剪成 30 秒视频", [], new Map())).toThrow("没有可用的视频素材");
});
