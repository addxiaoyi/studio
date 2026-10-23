import { describe, expect, it } from "vitest";

import { localAssetFileName } from "@/lib/local-asset-storage";

describe("local asset filenames", () => {
  it("removes path syntax and keeps the correct media extension", () => {
    expect(localAssetFileName("../campaign: hero?.png", "image/jpeg", "image")).toBe("campaign- hero-.jpg");
    expect(localAssetFileName("launch video", "video/mp4", "video")).toBe("launch video.mp4");
  });

  it("uses a safe fallback for an empty title", () => {
    expect(localAssetFileName("...", "image/png", "image")).toBe("helstera-asset.png");
  });
});
