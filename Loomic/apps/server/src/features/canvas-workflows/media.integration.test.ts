import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runOneTake } from "../onetake/runner.js";

it.skipIf(!process.env.HELSTERA_ONETAKE_PYTHON)(
  "composes real clips in order with audio and extracts a decodable frame",
  async () => {
    const folder = await mkdtemp(join(tmpdir(), "workflow-media-test-"));
    const ffmpeg = process.env.HELSTERA_FFMPEG || "ffmpeg",
      ffprobe = process.env.HELSTERA_FFPROBE || "ffprobe";
    try {
      const paths = [join(folder, "red.mp4"), join(folder, "blue.mp4")];
      for (const [index, path] of paths.entries()) {
        const made = spawnSync(
          ffmpeg,
          [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            `color=c=${index ? "blue" : "red"}:s=320x240:r=30:d=0.5`,
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-y",
            path,
          ],
          { windowsHide: true, encoding: "utf8" },
        );
        expect(made.status, made.stderr).toBe(0);
      }
      const output = join(folder, "joined.mp4");
      const composed = (await runOneTake({
        operation: "compose",
        sources: paths,
        output,
        aspect: "original",
      })) as { duration: number };
      expect(composed.duration).toBeCloseTo(1, 1);
      const probe = spawnSync(
        ffprobe,
        ["-v", "error", "-show_streams", "-of", "json", output],
        { encoding: "utf8", windowsHide: true },
      );
      expect(
        JSON.parse(probe.stdout).streams.map(
          (stream: { codec_type: string }) => stream.codec_type,
        ),
      ).toEqual(["video", "audio"]);
      for (const [time, color] of [
        [0.2, 0],
        [0.7, 2],
      ] as const) {
        const frame = join(folder, `frame-${color}.png`);
        await runOneTake({
          operation: "frame",
          source: output,
          output: frame,
          at: time,
        });
        expect((await readFile(frame)).subarray(1, 4).toString()).toBe("PNG");
        const pixel = spawnSync(
          ffmpeg,
          [
            "-v",
            "error",
            "-i",
            frame,
            "-vf",
            "scale=1:1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
          ],
          { windowsHide: true },
        );
        expect(pixel.status).toBe(0);
        expect(pixel.stdout[color]).toBeGreaterThan(200);
      }
      await expect(
        runOneTake({
          operation: "frame",
          source: output,
          output: join(folder, "bad.png"),
          at: 5,
        }),
      ).rejects.toThrow();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
  60000,
);
