import { expect, it } from "vitest";
import { presentationProgress } from "./recording-progress.js";

it("estimates remaining render time from recent actual presentation progress", () => {
  expect(presentationProgress(12, [
    { stage: "presentation_recording", detail: "演示 25%", created_at: "2026-11-08T00:00:10Z" },
    { stage: "presentation_recording", detail: "演示 50%", created_at: "2026-11-08T00:00:20Z" },
  ])).toEqual({ renderedSeconds: 6, totalSeconds: 12, elapsedSeconds: 10, remainingSeconds: 20, pageIndex: 1, pageCount: 1 });
});
it("does not invent an estimate before enough frames exist", () => {
  expect(presentationProgress(12, [{ stage: "presentation_recording", detail: "演示 0%", created_at: new Date() }])?.remainingSeconds).toBeNull();
  expect(presentationProgress(12, [{ stage: "page_loading", detail: "Loading", created_at: new Date() }])).toBeUndefined();
});
