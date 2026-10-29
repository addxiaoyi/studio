import { describe, expect, it } from "vitest";
import { formatDesktopPlanReview } from "./desktop-plan-review.js";

describe("desktop plan review summary", () => {
  it("lists each proposed action without showing entered text", () => {
    const summary = formatDesktopPlanReview({
      goal: "Rename project files",
      executionMode: "windows_ui",
      english: true,
      actions: [
        { kind: "focus_window", target: "File Explorer" },
        { kind: "native_type", target: "Filename", value: "private value" } as never,
      ],
    });

    expect(summary).toContain("Focus window: File Explorer");
    expect(summary).toContain("Enter text in desktop field: Filename");
    expect(summary).not.toContain("private value");
  });
});
