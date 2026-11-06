import { describe, expect, it, vi } from "vitest";
import { withVideoExportCleanup } from "./video-export-cleanup.js";

describe("video export cleanup", () => {
  it("returns the saved path and a warning when cleanup fails", async () => {
    const cleanup = vi.fn().mockRejectedValue(new Error("busy"));
    await expect(withVideoExportCleanup("temp", async () => ({ path: "finished.mp4" }), cleanup)).resolves.toEqual({ path: "finished.mp4", cleanupWarnings: ["temp"] });
  });

  it("preserves both the export and cleanup failures", async () => {
    const failure = new Error("render failed");
    const cleanupFailure = new Error("cleanup failed");
    try {
      await withVideoExportCleanup("temp", async () => { throw failure; }, async () => { throw cleanupFailure; });
      throw new Error("expected an error");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([failure, cleanupFailure]);
    }
  });
});
