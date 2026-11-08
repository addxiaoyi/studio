import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import { CAPTURE_FPS, ffmpegBinary, frameEncoder } from "./video-encoder.js";

const MAX_RECORDING_BYTES = 40 * 1024 * 1024;
const MAX_RECORDING_SECONDS = 60;
const WIDTH = 1280;
const HEIGHT = 720;

async function noisyFrames() {
  const frames: Buffer[] = [];
  let seed = 12345;
  for (let frame = 0; frame < 12; frame++) {
    const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
    for (let pixel = 0; pixel < pixels.length; pixel++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      pixels[pixel] = seed & 255;
    }
    frames.push(await sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).jpeg({ quality: 85 }).toBuffer());
  }
  return frames;
}

it("keeps a changing 720p recording inside the upload budget without dropping frames", async () => {
  const seconds = Number(process.env.HELT_ENCODER_TEST_SECONDS ?? 6);
  if (!Number.isInteger(seconds) || seconds < 6 || seconds > MAX_RECORDING_SECONDS) throw new Error("Encoder test duration must be 6–60 seconds");
  const directory = await mkdtemp(join(tmpdir(), "capture-budget-"));
  const file = join(directory, "noisy.webm");
  const frames = await noisyFrames();
  const encoder = frameEncoder(file);
  let closed = false;
  try {
    for (let frame = 0; frame < seconds * CAPTURE_FPS; frame++) await encoder.frame(frames[frame % frames.length]!);
    await encoder.close();
    closed = true;
    const bytes = (await stat(file)).size;
    const evidence = process.env.HELT_CAPTURE_TEST_OUTPUT ?? directory;
    await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, "encoding-budget.json"), JSON.stringify({ file, bytes, seconds, projectedMinuteBytes: bytes * MAX_RECORDING_SECONDS / seconds }, null, 2));
    expect(bytes).toBeLessThan(MAX_RECORDING_BYTES * seconds / MAX_RECORDING_SECONDS);
    const decoded = spawnSync(ffmpegBinary(), ["-hide_banner", "-xerror", "-i", file, "-f", "null", "-"], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
    expect(decoded.status, decoded.stderr ?? decoded.error?.message).toBe(0);
    expect(decoded.stderr).toMatch(new RegExp(`frame=\\s*${seconds * CAPTURE_FPS}\\b`));
    expect(decoded.stderr).toContain("60 fps");
  } finally {
    if (!closed) await encoder.abort();
  }
}, 240_000);
