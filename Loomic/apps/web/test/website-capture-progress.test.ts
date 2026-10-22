import { describe, expect, it } from "vitest";

import { formatWebsiteCaptureEventTime, formatWebsiteCaptureStage } from "../src/components/chat/website-capture-progress";

describe("website capture progress labels", () => {
  it("translates known lifecycle stages and keeps unknown stages readable", () => {
    expect(formatWebsiteCaptureStage("saving_assets")).toBe("保存截图与录屏");
    expect(formatWebsiteCaptureStage("external_review")).toBe("external review");
  });

  it("formats valid event times and tolerates invalid timestamps", () => {
    expect(formatWebsiteCaptureEventTime("not-a-date")).toBe("");
    expect(formatWebsiteCaptureEventTime("2026-10-22T10:15:00.000Z")).not.toBe("");
  });
});
