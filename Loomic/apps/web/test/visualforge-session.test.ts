import { expect, it } from "vitest";
import { studioImportName } from "@/lib/visualforge-session";

it("keeps existing media when importing another file with the same name", () => {
  expect(studioImportName("recording.mp4", ["recording.mp4", "recording-2.mp4"])).toBe("recording-3.mp4");
  expect(studioImportName("Recording.mp4", ["recording.mp4"])).toBe("Recording-2.mp4");
  expect(studioImportName("../clip.mp4", [])).toBe("..-clip.mp4");
});
