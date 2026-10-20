import { describe, expect, it } from "vitest";

import { isCompatibleAssetPreviewMime } from "../src/lib/asset-preview";

describe("asset preview MIME compatibility", () => {
  it("accepts image previews for video assets because the server returns a frame", () => {
    expect(isCompatibleAssetPreviewMime("video", "image/jpeg")).toBe(true);
  });

  it("keeps image assets strict", () => {
    expect(isCompatibleAssetPreviewMime("image", "video/mp4")).toBe(false);
    expect(isCompatibleAssetPreviewMime("image", "image/webp")).toBe(true);
  });
});
