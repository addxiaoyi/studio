import { describe, expect, it } from "vitest";
import { videoExportConfirmation } from "./video-export-confirmation.js";
import type { VideoExportInput } from "./video-export-request.js";

describe("video export confirmation", () => {
  const request: VideoExportInput = {
    format: "portrait",
    clips: [
      { name: "first.mp4", mimeType: "video/mp4", bytes: new ArrayBuffer(1), startMs: 1200, endMs: 3500 },
      { name: "second.webm", mimeType: "video/webm", bytes: new ArrayBuffer(1), startMs: 0, endMs: 1000 },
    ],
  };

  it("defaults to cancellation and identifies the output and every clip", () => {
    const dialog = videoExportConfirmation(request, "C:\\Videos");
    expect(dialog.buttons).toHaveLength(2);
    expect(dialog.defaultId).toBe(0);
    expect(dialog.cancelId).toBe(0);
    expect(dialog.detail).toContain("720\u00d71280");
    expect(dialog.detail).toContain("C:\\Videos");
    expect(dialog.detail).toContain("1. first.mp4 (1.2s - 3.5s)");
    expect(dialog.detail).toContain("2. second.webm (0.0s - 1.0s)");
  });

  it("shows landscape dimensions for landscape exports", () => {
    expect(videoExportConfirmation({ ...request, format: "landscape" }, "C:\\Videos").detail).toContain("1280\u00d7720");
  });
});
