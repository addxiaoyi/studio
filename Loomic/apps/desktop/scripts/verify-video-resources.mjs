import { statSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_FILES = [
  "ffmpeg.exe", "ffprobe.exe", "LICENSE.txt", "SOURCE.txt",
  "ffmpeg-source.tar", "x264-source.tar", "ffmpeg-config.mak", "x264-config.mak",
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
}
