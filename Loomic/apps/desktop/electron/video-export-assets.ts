import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { videoProjectSchema, type VideoProject } from "@helstera/shared";
import type { ExportClip } from "./video-export-plan.js";

const MAX_SOURCE_BYTES = 250 * 1024 * 1024;

export type VideoSourceInfo = { durationMs: number; hasAudio: boolean };

export async function resolveVideoExportClips(
  project: VideoProject,
  assetDirectory: string,
  inspectVideo: (path: string, format: ExportClip["inputFormat"]) => Promise<VideoSourceInfo>,
): Promise<ExportClip[]> {
  const parsed = videoProjectSchema.parse(project);
  if (!isAbsolute(assetDirectory)) throw new Error("The asset directory must be an absolute local path.");
  if (parsed.actions.length || parsed.clips.some((clip) => clip.track !== 0)) {
    throw new Error("This export does not support timeline actions or multiple tracks.");
  }
  if (!parsed.clips.length || parsed.clips.length > 20) throw new Error("Select between 1 and 20 clips to export.");
  const root = await realpath(assetDirectory);
  const assets = new Map(parsed.assets.map((asset) => [asset.assetId, asset]));
  if (assets.size !== parsed.assets.length) throw new Error("Video project contains duplicate asset IDs.");
  const cache = new Map<string, { path: string; inputFormat: ExportClip["inputFormat"]; info: VideoSourceInfo }>();
  const resolved: ExportClip[] = [];
  for (const clip of parsed.clips) {
    let source = cache.get(clip.assetId);
    if (!source) {
      const asset = assets.get(clip.assetId);
      if (!asset) throw new Error("A timeline clip references a missing asset.");
      if (!isAbsolute(asset.path) || !["video/mp4", "video/webm"].includes(asset.mimeType)) throw new Error("Unsupported video asset.");
      const path = await realpath(asset.path);
      const inside = relative(root, path);
      if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error("Video asset is outside the selected local directory.");
      const file = await stat(path);
      if (!file.isFile() || file.size === 0 || file.size > MAX_SOURCE_BYTES) throw new Error("Video asset is empty or exceeds the 250 MB limit.");
      const inputFormat = asset.mimeType === "video/mp4" ? "mov" : "matroska";
      const info = await inspectVideo(path, inputFormat);
      if (!Number.isSafeInteger(info.durationMs) || info.durationMs <= 0 || typeof info.hasAudio !== "boolean") throw new Error("Video metadata could not be verified.");
      source = { path, inputFormat, info };
      cache.set(clip.assetId, source);
    }
    if (clip.endMs > source.info.durationMs) throw new Error("A clip extends beyond the source video.");
    resolved.push({ sourcePath: source.path, inputFormat: source.inputFormat, startMs: clip.startMs, endMs: clip.endMs, hasAudio: source.info.hasAudio });
  }
  return resolved;
}
