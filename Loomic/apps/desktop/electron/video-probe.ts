import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import type { VideoSourceInfo } from "./video-export-assets.js";
import type { ExportClip } from "./video-export-plan.js";

const execFileAsync = promisify(execFile);
const MAX_PROBE_BYTES = 1024 * 1024;
const MAX_PACKET_BYTES = 16 * 1024 * 1024;

async function probePacketDuration(ffprobePath: string, sourcePath: string): Promise<number> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(ffprobePath, [
      "-v", "error", "-protocol_whitelist", "file,pipe", "-f", "matroska", "-select_streams", "v:0",
      "-show_entries", "packet=pts_time,duration_time", "-of", "csv=p=0", "-i", sourcePath,
    ], { encoding: "utf8", timeout: 60_000, maxBuffer: MAX_PACKET_BYTES, windowsHide: true }));
  } catch (error) {
    throw new Error("Could not inspect the recording's video timestamps.", { cause: error });
  }
  let endSeconds = 0;
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const duration = Number(match[2]);
    if (Number.isFinite(start) && Number.isFinite(duration) && duration > 0) endSeconds = Math.max(endSeconds, start + duration);
  }
  const durationMs = Math.floor(endSeconds * 1000);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new Error("The source video duration is unavailable.");
  return durationMs;
}

export async function probeVideo(ffprobePath: string, sourcePath: string, format: ExportClip["inputFormat"]): Promise<VideoSourceInfo> {
  if (!isAbsolute(ffprobePath) || !isAbsolute(sourcePath)) throw new Error("Video probe requires local absolute paths.");
  if (format !== "mov" && format !== "matroska") throw new Error("Video input format is invalid.");
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(ffprobePath, [
      "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration:stream=codec_type",
      "-of", "json", "-f", format, "-i", sourcePath,
    ], { encoding: "utf8", timeout: 15_000, maxBuffer: MAX_PROBE_BYTES, windowsHide: true }));
  } catch (error) {
    throw new Error("Could not inspect the source video.", { cause: error });
  }
  let metadata: { format?: { duration?: unknown }; streams?: Array<{ codec_type?: unknown }> };
  try { metadata = JSON.parse(stdout); }
  catch (error) { throw new Error("Video metadata is not valid JSON.", { cause: error }); }
  if (!Array.isArray(metadata.streams) || !metadata.streams.some((stream) => stream?.codec_type === "video")) {
    throw new Error("The source file has no video stream.");
  }
  let durationMs = Math.round(Number(metadata.format?.duration) * 1000);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    if (format !== "matroska") throw new Error("The source video duration is unavailable.");
    durationMs = await probePacketDuration(ffprobePath, sourcePath);
  }
  return { durationMs, hasAudio: metadata.streams.some((stream) => stream?.codec_type === "audio") };
}
