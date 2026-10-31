import { describe, expect, it, vi } from "vitest";

import { writeCaptureToCanvas } from "./agent-goal-background.js";

describe("background website capture canvas writeback", () => {
  it("writes captured screenshots and recordings to the selected canvas", async () => {
    const image = vi.fn().mockResolvedValue({ elementId: "image-element" });
    const video = vi.fn().mockResolvedValue({ elementId: "video-element" });
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("select id,object_path,mime_type from generated_assets")) {
          return { rows: [
            { id: "asset-image", object_path: "workspace/image.jpg", mime_type: "image/jpeg" },
            { id: "asset-video", object_path: "workspace/recording.webm", mime_type: "video/webm" },
          ] };
        }
        return { rows: [] };
      }),
    };

    await expect(writeCaptureToCanvas({
      db: db as never,
      storage: {} as never,
      writer: { insertImage: image, insertVideo: video },
      canvasId: "canvas-1",
      taskId: "task-1",
      workspaceId: "workspace-1",
      pages: [{ assetId: "asset-image", title: "Home" }],
      recordingAssetId: "asset-video",
      recordingUrl: "https://studio.example.test/api/uploads/video/file",
    })).resolves.toEqual(["image-element", "video-element"]);
    expect(image).toHaveBeenCalledWith(db, expect.anything(), expect.objectContaining({
      canvasId: "canvas-1",
      objectPath: "workspace/image.jpg",
      jobId: "task-1:screenshot:asset-image",
    }));
    expect(video).toHaveBeenCalledWith(db, expect.objectContaining({
      canvasId: "canvas-1",
      signedUrl: "https://studio.example.test/api/uploads/video/file",
      jobId: "task-1:recording:asset-video",
    }));
  });
});
