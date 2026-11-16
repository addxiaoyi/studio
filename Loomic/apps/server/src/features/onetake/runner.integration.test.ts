import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compileTranscript,
  createTranscriptEdit,
  transcriptExportSchema,
  transcriptSchema,
} from "@helstera/shared";
import { expect, it } from "vitest";
import { runOneTake } from "./runner.js";

it.skipIf(!process.env.HELT_ONETAKE_TEST_SOURCE)(
  "transcribes real speech and exports retimed subtitles through FFmpeg",
  async () => {
    const source = process.env.HELT_ONETAKE_TEST_SOURCE;
    if (!source) throw new Error("A real speech fixture is required.");
    const directory = await mkdtemp(join(tmpdir(), "loomic-onetake-render-"));
    try {
      const transcript = transcriptSchema.parse(
        await runOneTake({
          operation: "transcribe",
          source,
          model: "tiny",
          language: "en",
        }),
      );
      expect(transcript.words.length).toBeGreaterThan(10);
      expect(
        transcript.words
          .map((word) => word.text)
          .join(" ")
          .toLowerCase(),
      ).toContain("video");
      const expectedText = process.env.HELT_ONETAKE_TEST_TEXT;
      if (expectedText) {
        const normalize = (text: string) =>
          text
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, "")
            .replace(/\s+/g, " ")
            .trim();
        expect(
          normalize(transcript.words.map((word) => word.text).join(" ")),
        ).toBe(normalize(expectedText));
      }
      expect(transcript.peaks?.some((peak) => peak > 0.01)).toBe(true);
      const edit = createTranscriptEdit(transcript);
      const [firstWord, secondWord] = edit.words;
      if (!firstWord || !secondWord)
        throw new Error("The transcript lacks editable words.");
      firstWord.deleted = true;
      edit.silences = edit.silences.map(() => true);
      secondWord.text = "EDITED";
      const compiled = compileTranscript(transcript, edit);
      expect(compiled.duration).toBeLessThan(transcript.duration);
      for (const format of ["mp4", "mov", "avi"] as const) {
        const output = join(directory, `edited.${format}`);
        const options = transcriptExportSchema.parse({
          format,
          aspect: "portrait",
          subtitle: {
            mode: format === "mov" ? "soft" : "burn",
            font: "Microsoft YaHei",
          },
        });
        const exported = (await runOneTake({
          operation: "export",
          source,
          output,
          options,
          compiled,
        })) as { bytes: number; duration: number };
        expect(exported.bytes).toBe((await stat(output)).size);
        expect(exported.bytes).toBeGreaterThan(1024);
        expect(Math.abs(exported.duration - compiled.duration)).toBeLessThan(
          0.25,
        );
        const decoded = spawnSync(
          process.env.HELSTERA_FFMPEG ?? "ffmpeg",
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-i",
            output,
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-f",
            "null",
            "-",
          ],
          { encoding: "utf8", windowsHide: true, timeout: 30_000 },
        );
        expect(decoded.error).toBeUndefined();
        expect(decoded.status, decoded.stderr).toBe(0);
        const inspected = spawnSync(
          process.env.HELSTERA_FFPROBE ?? "ffprobe",
          ["-v", "error", "-show_streams", "-of", "json", output],
          { encoding: "utf8", windowsHide: true, timeout: 10_000 },
        );
        expect(inspected.error).toBeUndefined();
        expect(inspected.status, inspected.stderr).toBe(0);
        const streams = (
          JSON.parse(inspected.stdout) as {
            streams: Array<{
              codec_type: string;
              codec_name: string;
              width?: number;
              height?: number;
            }>;
          }
        ).streams;
        expect(
          streams.find((stream) => stream.codec_type === "video"),
        ).toMatchObject({ width: 720, height: 1280 });
        expect(
          streams.some(
            (stream) =>
              stream.codec_type === "subtitle" &&
              stream.codec_name === "mov_text",
          ),
        ).toBe(format === "mov");
      }
      expect(await readFile(join(directory, "captions.srt"), "utf8")).toContain(
        "EDITED",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  240_000,
);
