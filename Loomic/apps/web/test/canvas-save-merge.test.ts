import { describe, expect, it } from "vitest";

import { mergeCanvasSaveWithRemoteContent } from "../src/components/canvas-editor";

describe("mergeCanvasSaveWithRemoteContent", () => {
it("preserves server-inserted media elements and their files without resurrecting deleted local items", () => {
    const merged = mergeCanvasSaveWithRemoteContent(
      {
        elements: [{ id: "local-shape", type: "rectangle" }],
        appState: { zoom: 1 },
        files: { localFile: { id: "localFile", dataURL: "data:image/png;base64,AA==" } },
      },
      {
        elements: [
          { id: "local-shape", type: "rectangle" },
          { id: "deleted-local", type: "rectangle", isDeleted: true },
          { id: "server-image", type: "image", fileId: "imageFile" },
          { id: "server-video", type: "embeddable", customData: { isVideo: true, jobId: "job-1" }, fileId: "videoFile" },
        ],
        files: {
          imageFile: { id: "imageFile", storageUrl: "/api/storage/image.png" },
          videoFile: { id: "videoFile", storageUrl: "/api/storage/video.mp4" },
        },
      },
    );

    expect(merged.elements.map((element) => element.id)).toEqual(["local-shape", "server-image", "server-video"]);
    expect(merged.files).toHaveProperty("imageFile");
    expect(merged.files).toHaveProperty("videoFile");
    expect(merged.files).toHaveProperty("localFile");
  });
});
