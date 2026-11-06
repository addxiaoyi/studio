import { expect, it } from "vitest";
import { validateVideoEditorPlan, type VideoEditorPlan, type VideoEditorPlanRequest } from "./video-editor-contracts.js";

const music = { assetName: "selected.wav", startMs: 200, volume: 0.3 };
const input: VideoEditorPlanRequest = { prompt: "配乐", projectId: "MyComp", compositionDuration: 2, media: ["selected.wav", "other.wav"].map(name => ({ name, mimeType: "audio/wav", duration: 3 })), music };
const action = { type: "audio" as const, ...music };

it("accepts the user's exact music selection", () => {
  expect(() => validateVideoEditorPlan({ summary: "配乐", actions: [action] }, input)).not.toThrow();
});

it.each([
  [], [action, action], [{ ...action, assetName: "other.wav" }], [{ ...action, startMs: 0 }], [{ ...action, volume: 0.8 }],
].map(actions => ({ actions })))("rejects model changes to a manual music choice: %j", ({ actions }) => {
  expect(() => validateVideoEditorPlan({ summary: "配乐", actions } as VideoEditorPlan, input)).toThrow("已选择的音乐");
});
