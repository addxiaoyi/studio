import { describe, expect, it } from "vitest";
import { selectRetryReferences, selectVideoReferences } from "../src/lib/video-reference-policy";

describe("video reference policy", () => {
  it("keeps only the first image from a large canvas selection", () => {
    const refs = Array.from({ length: 15 }, (_, index) => ({
      id: String(index),
      mimeType: "image/png",
    }));

    expect(selectVideoReferences(refs)).toEqual([refs[0]]);
  });

  it("ignores non-image attachments", () => {
    expect(selectVideoReferences([
      { id: "video", mimeType: "video/mp4" },
      { id: "image", mimeType: "image/png" },
    ])).toEqual([{ id: "image", mimeType: "image/png" }]);
  });

  it("deduplicates retry attachments and keeps only one video first frame", () => {
    const first = { id: "first", assetId: "asset-1", url: "/first", mimeType: "image/png" };
    const duplicate = { id: "duplicate", assetId: "asset-1", url: "/duplicate", mimeType: "image/png" };
    const second = { id: "second", assetId: "asset-2", url: "/second", mimeType: "image/png" };

    expect(selectRetryReferences([first, duplicate, second], false)).toEqual([first, second]);
    expect(selectRetryReferences([first, duplicate, second], true)).toEqual([first]);
  });
});
