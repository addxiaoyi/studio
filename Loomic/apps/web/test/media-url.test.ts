import { describe, expect, it } from "vitest";

import {
  appendMediaQuery,
  buildMediaDownloadUrl,
  buildMediaPreviewUrl,
} from "../src/lib/media-url";

describe("media URL helpers", () => {
  it("updates existing query parameters without creating a second question mark", () => {
    expect(
      buildMediaPreviewUrl("/api/uploads/asset/file?session=abc#preview"),
    ).toBe("/api/uploads/asset/file?session=abc&preview=1#preview");
  });

  it("switches a media URL from preview mode to original download mode", () => {
    expect(buildMediaDownloadUrl("https://example.test/file?preview=1")).toBe(
      "https://example.test/file?download=1",
    );
  });

  it("preserves relative URLs and supports deleting stale parameters", () => {
    expect(
      appendMediaQuery("/file?preview=1", { preview: null, download: "1" }),
    ).toBe("/file?download=1");
  });
});
