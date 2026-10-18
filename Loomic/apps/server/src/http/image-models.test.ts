import { describe, expect, it } from "vitest";
import { filterVisibleImageModelRows } from "./image-models.js";

describe("image model catalog filtering", () => {
  it("does not expose retired configured image models", () => {
    const rows = filterVisibleImageModelRows([
      { model_id: "doubao-seedream-3-0-t2i-250415" },
      { model_id: "doubao-seededit-3-0-i2i-250628" },
      { model_id: "high_aes_general_v30l_zt2i" },
      { model_id: "gpt-image-1.5" },
      { model_id: "google-official/gemini-3.1-flash-image-preview" },
      { model_id: "google-vertex/gemini-3-pro-image-preview" },
      { model_id: "google/nano-banana-pro" },
      { model_id: "gpt-image-2" },
    ]);

    expect(rows.map((row) => row.model_id)).toEqual([
      "doubao-seedream-3-0-t2i-250415",
      "gpt-image-2",
    ]);
  });
});
