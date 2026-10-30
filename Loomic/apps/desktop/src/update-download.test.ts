import { describe, expect, it } from "vitest";
import { DESKTOP_DOWNLOADS_URL, isPortableManualUpdate } from "./update-download";

describe("portable update guidance", () => {
  it("recognizes the portable manual-update state", () => {
    expect(isPortableManualUpdate({ status: "not-available", reason: "portable build requires manual update" })).toBe(true);
    expect(DESKTOP_DOWNLOADS_URL).toBe("https://studio.0st.top/downloads/");
  });

  it("does not misclassify a normal latest-version state", () => {
    expect(isPortableManualUpdate({ status: "not-available" })).toBe(false);
  });
});
