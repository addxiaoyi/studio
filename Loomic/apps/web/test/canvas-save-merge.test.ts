import { describe, expect, it } from "vitest";

import { getThumbnailElements, mergeCanvasSaveWithRemoteContent } from "../src/components/canvas-editor";

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


describe("canvas thumbnail element selection", () => {
  it("uses the current viewport when distant canvas elements would create a broken-looking preview", () => {
    const elements = [
      { id: "visible", x: 10, y: 20, width: 200, height: 120 },
      { id: "distant", x: 4000, y: 20, width: 200, height: 120 },
    ];

    expect(getThumbnailElements(elements, {
      width: 800,
      height: 600,
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
    }).map((element) => element.id)).toEqual(["visible"]);
  });

  it("falls back to all live elements when the viewport has no content", () => {
    const elements = [
      { id: "one", x: 4000, y: 20, width: 200, height: 120 },
      { id: "two", x: 4500, y: 20, width: 200, height: 120 },
    ];

    expect(getThumbnailElements(elements, {
      width: 800,
      height: 600,
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
    }).map((element) => element.id)).toEqual(["one", "two"]);
  });
});
