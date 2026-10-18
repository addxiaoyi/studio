import { describe, expect, it } from "vitest";
import { collapseDuplicateImageReferences } from "../src/components/chat/utils";

describe("collapseDuplicateImageReferences", () => {
  it("collapses repeated asset references without changing the original list", () => {
    const references = [
      { assetId: "asset-1", url: "/one.png" },
      { assetId: "asset-1", url: "/one.png" },
      { assetId: "asset-2", url: "/two.png" },
    ];

    const result = collapseDuplicateImageReferences(references);

    expect(result).toEqual({ images: [references[0], references[2]], duplicateCount: 1 });
    expect(references).toHaveLength(3);
  });

  it("uses the URL when an asset ID is not available", () => {
    const result = collapseDuplicateImageReferences([
      { url: "/same.png" },
      { url: "/same.png" },
      { url: "/other.png" },
    ]);

    expect(result).toEqual({ images: [{ url: "/same.png" }, { url: "/other.png" }], duplicateCount: 1 });
  });
});
