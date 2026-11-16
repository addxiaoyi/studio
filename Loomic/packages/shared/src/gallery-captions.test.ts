import { describe, expect, it } from "vitest";
import {
  MAX_GALLERY_CAPTION_BYTES,
  galleryCaptionsVtt,
  parseGalleryCaptions,
} from "./gallery-captions.js";

const input = {
  vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\n欢迎\n\nsecond\n00:01.000 --> 00:02.000\nWelcome",
  language: "zh-CN",
  label: "中文字幕",
  consent: true as const,
};
describe("explicit Gallery caption snapshot", () => {
  it("preserves cue text and timing and serializes a real WebVTT document", () => {
    const snapshot = parseGalleryCaptions(input);
    expect(snapshot.cues).toEqual([
      { startMs: 0, endMs: 1000, text: "欢迎" },
      { startMs: 1000, endMs: 2000, text: "Welcome" },
    ]);
    expect(galleryCaptionsVtt(snapshot)).toContain(
      "00:00:01.000 --> 00:00:02.000\nWelcome",
    );
  });
  it("escapes markup, cue arrows and ampersands instead of publishing active VTT markup", () => {
    const snapshot = parseGalleryCaptions({
      ...input,
      vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\n<script>alert(1)</script> & 2 --> 3",
    });
    const vtt = galleryCaptionsVtt(snapshot);
    expect(vtt).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt; &amp; 2 --&gt; 3",
    );
    expect(vtt).not.toContain("<script>");
  });
  it.each([
    "",
    "<svg onload=alert(1)>",
    "WEBVTT\n\nSTYLE\n::cue {color:red}",
    "WEBVTT\n\n00:01.000 --> 00:00.000\nwrong",
    "WEBVTT\n\n02:00:00.000 --> 02:00:01.000\nlong",
    "WEBVTT\n\n00:00.000 --> 00:01.000 line:2\nsettings",
  ])("rejects invalid or unsupported VTT %s", (vtt) => {
    expect(() => parseGalleryCaptions({ ...input, vtt })).toThrow();
  });
  it("requires consent and bounds UTF-8 bytes, language and cue ordering", () => {
    expect(() =>
      parseGalleryCaptions({ ...input, consent: false as never }),
    ).toThrow("确认");
    expect(() =>
      parseGalleryCaptions({
        ...input,
        vtt: "文".repeat(MAX_GALLERY_CAPTION_BYTES),
      }),
    ).toThrow("256 KB");
    expect(() =>
      parseGalleryCaptions({ ...input, language: "<script>" }),
    ).toThrow("语言");
    expect(() =>
      parseGalleryCaptions({
        ...input,
        vtt: input.vtt.replace(
          "00:01.000 --> 00:02.000",
          "00:00.500 --> 00:02.000",
        ),
      }),
    ).toThrow("不重叠");
  });
});
