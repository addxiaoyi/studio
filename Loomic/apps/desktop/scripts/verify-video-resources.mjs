import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const REQUIRED_FILES = [
  "ffmpeg.exe", "ffprobe.exe", "LICENSE.txt", "SOURCE.txt",
  "ffmpeg-source.tar.xz", "x264-source.tar.xz", "ffmpeg-config.mak", "x264-config.mak", "SHA256SUMS",
];

export function verifyWindowsVideoResources(directory) {
  for (const name of REQUIRED_FILES) {
    const path = join(directory, name);
    let info;
    try {
      info = statSync(path);
    } catch (error) {
      throw new Error(`Windows video export resource is missing: ${path}`, { cause: error });
    }
    if (!info.isFile() || info.size === 0) {
      throw new Error(`Windows video export resource must be a non-empty file: ${path}`);
    }
  }
  const manifest = readFileSync(join(directory, "SHA256SUMS"), "utf8");
  for (const name of ["ffmpeg.exe", "ffprobe.exe", "ffmpeg-source.tar.xz", "x264-source.tar.xz"]) {
    const line = manifest.split(/\r?\n/).find((entry) => entry.trim().endsWith(`  ${name}`));
    const expected = line?.split(/\s+/)[0];
    const actual = createHash("sha256").update(readFileSync(join(directory, name))).digest("hex");
    if (expected !== actual) throw new Error(`Windows video resource checksum mismatch: ${name}`);
  }
}
