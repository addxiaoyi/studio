import { describe, expect, it } from "vitest";
import { canTransitionFeedPackage, nextFeedPackageStatus } from "./feed-state.js";

describe("feed package state machine", () => {
  it("accepts the review-to-render path", () => {
    expect(canTransitionFeedPackage("structured", "structure_approved")).toBe(true);
    expect(nextFeedPackageStatus("structure_approved")).toBe("approved");
    expect(canTransitionFeedPackage("approved", "render_started")).toBe(true);
    expect(nextFeedPackageStatus("render_started")).toBe("rendering");
    expect(canTransitionFeedPackage("rendering", "render_ready")).toBe(true);
    expect(nextFeedPackageStatus("render_ready")).toBe("ready");
  });

  it("rejects skipping approval or retrying a completed render", () => {
    expect(canTransitionFeedPackage("draft", "render_started")).toBe(false);
    expect(canTransitionFeedPackage("ready", "render_started")).toBe(false);
    expect(canTransitionFeedPackage("failed", "render_started")).toBe(true);
  });
});
