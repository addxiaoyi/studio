import { expect, it } from "vitest";
import { createWebsiteCaptureRequestSchema } from "./website-capture.js";
const input = {
  url: "https://example.com",
  mode: "isolated",
  recordVideo: true,
  pageLimit: 1,
  idempotencyKey: "demo",
  presentation: {
    style: "cursor-rebuild",
    durationSeconds: 24,
    cursorCount: 4,
  },
};
it("requires explicit recording and isolated mode for a website presentation", () => {
  expect(createWebsiteCaptureRequestSchema.safeParse(input).success).toBe(true);
  for (const patch of [
    { recordVideo: false },
    { mode: "local" },
    { pageLimit: 4 },
    { presentation: { ...input.presentation, durationSeconds: 999 } },
    { presentation: { ...input.presentation, cursorCount: 99 } },
  ])
    expect(
      createWebsiteCaptureRequestSchema.safeParse({ ...input, ...patch })
        .success,
    ).toBe(false);
});
