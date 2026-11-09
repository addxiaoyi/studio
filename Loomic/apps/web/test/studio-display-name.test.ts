import { expect, it } from "vitest";
import { studioDisplayName } from "@/lib/studio-display-name";
it("keeps user names and only simplifies system identifiers", () => {
  expect(studioDisplayName("我的开场.webm")).toBe("我的开场.webm");
  expect(
    studioDisplayName(
      "generated-11111111-1111-4111-8111-111111111111-封面.png",
    ),
  ).toBe("封面.png");
  expect(studioDisplayName("Canvas-0123456789abcdef")).toBe("画布成片");
  expect(studioDisplayName("<Video>", true)).toBe("Video");
});
