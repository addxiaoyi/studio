import { describe, expect, it } from "vitest";
import { compileTranscript, createTranscriptEdit, transcriptSchema, transcriptExportSchema } from "./onetake.js";

const transcript = {
  duration: 6,
  words: [
    { text: "你好", start: 0, end: 1, confidence: 1, kind: "normal" },
    { text: "嗯", start: 1, end: 2, confidence: 0.9, kind: "filler" },
    { text: "世界", start: 4, end: 5, confidence: 1, kind: "normal" },
  ],
  silences: [{ start: 2, end: 4 }],
} as const;

describe("OneTake text edits", () => {
  it("supports automatic subtitle sizing without overriding an explicit size", () => {
    expect(transcriptExportSchema.parse({ subtitle: {} }).subtitle.size).toBeNull();
    expect(transcriptExportSchema.parse({ subtitle: { size: 32 } }).subtitle.size).toBe(32);
  });
  it("does not delete suggestions until selected", () => {
    const document = transcriptSchema.parse(transcript);
    expect(compileTranscript(document, createTranscriptEdit(document)).segments).toEqual([{ start: 0, end: 6 }]);
  });
  it("merges deleted words and silence and retimes surviving captions", () => {
    const document = transcriptSchema.parse(transcript);
    const edit = createTranscriptEdit(document);
    edit.words[1]!.deleted = true;
    edit.silences[0] = true;
    const compiled = compileTranscript(document, edit);
    expect(compiled.segments).toEqual([{ start: 0, end: 1 }, { start: 4, end: 6 }]);
    expect(compiled.duration).toBe(3);
    expect(compiled.captions.map(caption => [caption.text, caption.startMs, caption.endMs])).toEqual([["你好", 0, 1000], ["世界", 1000, 2000]]);
    expect(compiled.srt).toContain("00:00:01,000 --> 00:00:02,000");
  });
  it("rejects changed word counts and all-empty cuts", () => {
    const document = transcriptSchema.parse({ duration: 1, words: [transcript.words[0]], silences: [] });
    expect(() => compileTranscript(document, { words: [], silences: [] })).toThrow();
    const edit = createTranscriptEdit(document);
    edit.words[0]!.deleted = true;
    expect(() => compileTranscript(document, edit)).toThrow(/保留/);
  });
  it("rejects unordered, overlapping, or out-of-range word timestamps", () => {
    expect(transcriptSchema.safeParse({ ...transcript, words: [...transcript.words].reverse() }).success).toBe(false);
    expect(transcriptSchema.safeParse({ ...transcript, duration: 0.5 }).success).toBe(false);
    expect(transcriptSchema.safeParse({ ...transcript, words: [{ ...transcript.words[0], end: 2 }, transcript.words[1]] }).success).toBe(false);
  });
  it("keeps corrected words without interpreting markup or new SRT blocks", () => {
    const document = transcriptSchema.parse(transcript);
    const edit = createTranscriptEdit(document);
    edit.words[0]!.text = "<b>你好</b>\n\n2 --> 3";
    const compiled = compileTranscript(document, edit);
    expect(compiled.captions[0]!.text).toBe("<b>你好</b> 2 --> 3");
    expect(compiled.srt).not.toContain("<b>");
  });
});
