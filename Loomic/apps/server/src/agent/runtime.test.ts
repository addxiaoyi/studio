import { describe, expect, it } from "vitest";

import { buildUserMessage, findCanvasReferenceImage } from "./runtime.js";

describe("buildUserMessage video preferences", () => {
  it("keeps automatic routing duration as structured context", () => {
    const message = buildUserMessage("生成信息流视频", [], undefined, [], {
      mode: "auto",
      models: [],
      duration: 15,
    });

    expect(message.text).toContain(
      '<human_video_generation_preference mode="auto" count="0" duration="15">',
    );
  });
});


describe("buildUserMessage manual model preferences", () => {
  it("marks manual image selection as strict and non-fallback", () => {
    const message = buildUserMessage("生成图片", [], {
      mode: "manual",
      models: ["gpt-image-2"],
    });
    expect(message.text).toContain('mode="manual" strict="true"');
    expect(message.text).toContain("只能使用用户选择的模型");
  });

  it("marks manual video selection as strict and non-fallback", () => {
    const message = buildUserMessage("生成视频", [], undefined, [], {
      mode: "manual",
      models: ["kling-v3-video"],
    });
    expect(message.text).toContain('mode="manual"');
    expect(message.text).toContain("不可擅自切换");
  });
});

const storage = {
  download: async () => ({ data: Buffer.from("canvas-image"), error: null }),
} as never;

describe("findCanvasReferenceImage", () => {
  it("prefers the newest visible image and ignores video elements", async () => {
    const image = await findCanvasReferenceImage(
      {
        elements: [
          { id: "old", type: "image", fileId: "old-file", updated: 1 },
          {
            id: "video",
            type: "image",
            fileId: "video-file",
            updated: 3,
            customData: { isVideo: true },
          },
          { id: "new", type: "image", fileId: "new-file", updated: 2 },
        ],
        files: {
          "old-file": { dataURL: "data:image/png;base64,b2xk" },
          "new-file": { dataURL: "data:image/png;base64,bmV3" },
          "video-file": { dataURL: "data:image/png;base64,dmlkZW8=" },
        },
      },
      storage,
    );

    expect(image).toBe("data:image/png;base64,bmV3");
  });

  it("reads persisted canvas files through the storage provider", async () => {
    const image = await findCanvasReferenceImage(
      {
        elements: [{ id: "image", type: "image", fileId: "file", updated: 1 }],
        files: {
          file: {
            dataURL: "oss://project-assets/canvas-files/canvas-id/file.png",
            mimeType: "image/png",
          },
        },
      },
      storage,
    );

    expect(image).toBe("data:image/png;base64,Y2FudmFzLWltYWdl");
  });
});
