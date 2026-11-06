import { describe, expect, it } from "vitest";
import { parseVideoExportInput } from "./video-export-request.js";

function clip() {
  return { name: "clip.webm", mimeType: "video/webm", bytes: new ArrayBuffer(10), startMs: 0, endMs: 1000 };
}

describe("video export request", () => {
  it.each([
    { captions: "invalid" },
    { captions: [{ text: "bad", startMs: -1, endMs: 100 }] },
    { captions: [{ text: "bad", startMs: 0, endMs: 2000 }] },
    { audio: [{ name: "music", mimeType: "text/plain", bytes: new ArrayBuffer(10), startMs: 0, volume: 1 }] },
    { audio: [{ name: "music", mimeType: "audio/wav", bytes: new ArrayBuffer(10), startMs: 1000, volume: 1 }] },
  ])("rejects invalid layers before confirmation: %j", layers => {
    expect(() => parseVideoExportInput({ format: "portrait", clips: [clip()], ...layers })).toThrow();
  });
  it("accepts supported clips and strips control characters from display names", () => {
    const request = parseVideoExportInput({ format: "portrait", clips: [{ ...clip(), name: "a\nb.webm" }] });
    expect(request.clips[0]?.name).toBe("a b.webm");
  });

  it("rejects remote URLs, empty inputs, unsupported types and invalid ranges", () => {
    for (const value of [
      { ...clip(), bytes: "https://example.com/video.mp4" },
      { ...clip(), bytes: new ArrayBuffer(0) },
      { ...clip(), mimeType: "application/x-mpegURL" },
      { ...clip(), startMs: 1000, endMs: 1000 },
    ]) expect(() => parseVideoExportInput({ format: "portrait", clips: [value] })).toThrow();
    expect(() => parseVideoExportInput({ format: "portrait", clips: Array.from({ length: 21 }, clip) })).toThrow();
    expect(() => parseVideoExportInput({ format: "other", clips: [clip()] })).toThrow();
  });
});
