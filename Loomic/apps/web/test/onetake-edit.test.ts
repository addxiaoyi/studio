import { describe, expect, it } from "vitest";
import { createTranscriptEdit, type Transcript } from "@helstera/shared";
import { transcriptHistory, editedPlaybackTime } from "../src/lib/onetake-edit";
import { oneTakeCopy } from "../src/lib/onetake-copy";

const transcript: Transcript = { duration: 4, words: [{ text: "hello", start: 0, end: 1, confidence: 1, kind: "normal" }, { text: "um", start: 1, end: 2, confidence: 1, kind: "filler" }], silences: [{ start: 2, end: 3 }] };
describe("OneTake edits", () => {
  it("undoes and redoes edits while discarding abandoned redo branches", () => {
    const original = createTranscriptEdit(transcript);
    const deleted = { ...original, words: original.words.map(word => ({ ...word, deleted: true })) };
    const initial = { past: [], present: original, future: [] };
    const changed = transcriptHistory(initial, { type: "edit", edit: deleted });
    const undone = transcriptHistory(changed, { type: "undo" });
    expect(undone.present).toEqual(original);
    expect(transcriptHistory(undone, { type: "redo" }).present).toEqual(deleted);
    expect(transcriptHistory(undone, { type: "edit", edit: { ...original, silences: [true] } }).future).toEqual([]);
  });
  it("preview skips only approved text edits and silence selections", () => {
    const edit = createTranscriptEdit(transcript);
    expect(editedPlaybackTime(transcript, edit, 1.5)).toBe(1.5);
    edit.words[1]!.deleted = true; edit.silences[0] = true;
    expect(editedPlaybackTime(transcript, edit, 1.5)).toBe(3);
  });
  it("keeps every interface key available in both locales", () => {
    expect(Object.keys(oneTakeCopy("zh-CN")).sort()).toEqual(Object.keys(oneTakeCopy("en-US")).sort());
    expect(Object.values(oneTakeCopy("en-US")).every(value => value.trim().length)).toBe(true);
  });
});
