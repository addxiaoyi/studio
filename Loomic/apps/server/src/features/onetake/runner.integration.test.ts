import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { compileTranscript, createTranscriptEdit, transcriptSchema, transcriptExportSchema } from "@helstera/shared";
import { runOneTake } from "./runner.js";

it.skipIf(!process.env.HELT_ONETAKE_TEST_SOURCE)("transcribes real speech and exports retimed subtitles through FFmpeg", async () => {
  const source = process.env.HELT_ONETAKE_TEST_SOURCE!;
  const directory = await mkdtemp(join(tmpdir(), "loomic-onetake-render-"));
  try {
    const transcript = transcriptSchema.parse(await runOneTake({ operation: "transcribe", source, model: "tiny", language: "en" }));
    expect(transcript.words.length).toBeGreaterThan(10);
    expect(transcript.words.map(word => word.text).join(" ").toLowerCase()).toContain("video");
    expect(transcript.peaks?.some(peak => peak > 0.01)).toBe(true);
    const edit = createTranscriptEdit(transcript);
    edit.words[0]!.deleted = true;
    edit.silences = edit.silences.map(() => true);
    edit.words[1]!.text = "EDITED";
    const compiled = compileTranscript(transcript, edit);
    expect(compiled.duration).toBeLessThan(transcript.duration);
    for (const format of ["mp4", "mov", "avi"] as const) {
      const output = join(directory, `edited.${format}`);
      const options = transcriptExportSchema.parse({ format, aspect: "portrait", subtitle: { mode: format === "mov" ? "soft" : "burn", font: "Microsoft YaHei" } });
      const exported = await runOneTake({ operation: "export", source, output, options, compiled }) as { bytes: number; duration: number };
      expect(exported.bytes).toBe((await stat(output)).size);
      expect(exported.bytes).toBeGreaterThan(1024);
      expect(Math.abs(exported.duration - compiled.duration)).toBeLessThan(0.25);
    }
    expect(await readFile(join(directory, "captions.srt"), "utf8")).toContain("EDITED");
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 240_000);
