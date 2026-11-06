import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildVideoExportArgs } from "./video-export-plan.js";

describe("video export plan", () => {
  const sourcePath = resolve("source file.webm");
  const outputPath = resolve("output.mp4");
  const clip = { sourcePath, inputFormat: "matroska" as const, startMs: 1200, endMs: 5000, hasAudio: true };

  it("trims and concatenates clips with normalized picture and audio", () => {
    const args = buildVideoExportArgs([clip, { ...clip, hasAudio: false }], outputPath, "portrait");
    expect(args.filter((arg) => arg === sourcePath)).toHaveLength(2);
    expect(args.filter((arg) => arg === "matroska")).toHaveLength(2);
    expect(args[args.length - 1]).toBe(outputPath);
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("trim=start=1.200:end=5.000");
    expect(filter).toContain("scale=720:1280");
    expect(filter).toContain("anullsrc=r=48000:cl=stereo");
    expect(filter).toContain("concat=n=2:v=1:a=1");
    expect(filter).not.toContain(sourcePath);
  });

  it("rejects remote paths, unsafe ranges and excessive clips", () => {
    expect(() => buildVideoExportArgs([{ ...clip, sourcePath: "https://example.com/a.mp4" }], outputPath, "landscape")).toThrow();
    expect(() => buildVideoExportArgs([{ ...clip, startMs: Number.NaN }], outputPath, "landscape")).toThrow();
    expect(() => buildVideoExportArgs(Array.from({ length: 21 }, () => clip), outputPath, "landscape")).toThrow();
    expect(() => buildVideoExportArgs([clip], "relative.mp4", "portrait")).toThrow();
    expect(() => buildVideoExportArgs([clip], sourcePath, "portrait")).toThrow();
    expect(() => buildVideoExportArgs([{ ...clip, sourcePath: "\\\\remote\\share\\file.mp4" }], outputPath, "portrait")).toThrow();
  });

  it("mixes approved background audio and burns approved captions", () => {
    const audioPath = resolve("music.mp3");
    const args = buildVideoExportArgs([clip], outputPath, "landscape", {
      captions: [{ sourcePath: resolve("caption.png"), startMs: 500, endMs: 1500 }],
      audio: [{ sourcePath: audioPath, inputFormat: "mp3", startMs: 250, volume: 0.7 }],
    });
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(args).toContain(audioPath);
    expect(filter).toContain("overlay=0:0");
    expect(filter).not.toContain("drawtext");
    expect(filter).toContain("adelay=250|250");
    expect(filter).toContain("volume=0.7");
    expect(filter).toContain("amix=inputs=2");
  });
  it("rejects remote audio and invalid overlays before invoking FFmpeg", () => {
    expect(() => buildVideoExportArgs([clip], outputPath, "portrait", { audio: [{ sourcePath: "https://example.com/music.mp3", inputFormat: "mp3", startMs: 0, volume: 1 }] })).toThrow();
    expect(() => buildVideoExportArgs([clip], outputPath, "portrait", { captions: [{ sourcePath: resolve("c.png"), startMs: -1, endMs: 100 }] })).toThrow();
  });
  it("accepts raw caption pixels supported by the packaged encoder", () => {
    const args = buildVideoExportArgs([clip], outputPath, "portrait", { captions: [{ sourcePath: resolve("caption.bgra"), startMs: 0, endMs: 1000, bitmap: { width: 720, height: 1280 } }] });
    expect(args).toContain("rawvideo");
    expect(args).toContain("bgra");
    expect(args).toContain("720x1280");
    expect(() => buildVideoExportArgs([clip], outputPath, "portrait", { captions: [{ sourcePath: resolve("caption.bgra"), startMs: 0, endMs: 1000, bitmap: { width: -1, height: 1280 } }] })).toThrow();
  });
});
