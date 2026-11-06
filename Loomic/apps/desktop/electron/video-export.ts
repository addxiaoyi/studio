import { createHash, randomUUID } from "node:crypto";
import { link, mkdtemp, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { videoProjectSchema, type VideoProject } from "@helstera/shared";
import { resolveVideoExportClips, type VideoSourceInfo } from "./video-export-assets.js";
import { buildVideoExportArgs, type ExportAudio, type ExportCaption, type ExportClip } from "./video-export-plan.js";
import { withVideoExportCleanup, type VideoExportResult } from "./video-export-cleanup.js";

const MAX_SOURCE_BYTES = 250 * 1024 * 1024;
const COPY_BUFFER_BYTES = 1024 * 1024;

async function fingerprintSource(source: string, destination?: string, signal?: AbortSignal): Promise<string> {
  const input = await open(source, "r");
  try {
    const info = await input.stat();
    if (!info.isFile() || info.size === 0 || info.size > MAX_SOURCE_BYTES) throw new Error("Video asset is empty or exceeds the 250 MB limit.");
    const output = destination ? await open(destination, "wx") : undefined;
    try {
      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
      let total = 0;
      for (;;) {
        if (signal?.aborted) throw new Error("Video export was canceled.");
        const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        total += bytesRead;
        if (total > MAX_SOURCE_BYTES) throw new Error("Video asset exceeds the 250 MB limit.");
        const chunk = buffer.subarray(0, bytesRead);
        hash.update(chunk);
        if (output) {
          let written = 0;
          while (written < chunk.length) {
            const result = await output.write(chunk, written, chunk.length - written);
            if (!result.bytesWritten) throw new Error("Could not save the video snapshot.");
            written += result.bytesWritten;
          }
        }
      }
      if (!total) throw new Error("Video asset is empty.");
      return hash.digest("hex");
    } finally {
      await output?.close();
    }
  } finally {
    await input.close();
  }
}

export type ExportSummary = {
  title: string;
  format: "portrait" | "landscape";
  clipCount: number;
  durationMs: number;
  destination: string;
};

type ExportOptions = {
  project: VideoProject;
  assetDirectory: string;
  format: "portrait" | "landscape";
  inspect: (path: string, format: ExportClip["inputFormat"]) => Promise<VideoSourceInfo>;
  confirm: (summary: ExportSummary) => Promise<boolean>;
  render: (args: readonly string[], signal?: AbortSignal) => Promise<unknown>;
  signal?: AbortSignal;
  captions?: readonly ExportCaption[];
  audio?: readonly ExportAudio[];
};

export async function exportVideo(options: ExportOptions): Promise<VideoExportResult | null> {
  const project = videoProjectSchema.parse(options.project);
  if (!isAbsolute(options.assetDirectory)) throw new Error("The asset directory must be an absolute local path.");
  if (options.format !== "portrait" && options.format !== "landscape") throw new Error("Export format is invalid.");
  const root = await realpath(options.assetDirectory);
  const clips = await resolveVideoExportClips(project, root, options.inspect);
  const fingerprints = new Map<string, string>();
  for (const clip of clips) {
    if (!fingerprints.has(clip.sourcePath)) fingerprints.set(clip.sourcePath, await fingerprintSource(clip.sourcePath, undefined, options.signal));
  }
  const target = join(root, `video-export-${randomUUID()}.mp4`);
  const summary: ExportSummary = {
    title: project.title,
    format: options.format,
    clipCount: clips.length,
    durationMs: clips.reduce((total, clip) => total + clip.endMs - clip.startMs, 0),
    destination: target,
  };
  // Validate the plan before asking for confirmation; the real path is allocated afterwards.
  buildVideoExportArgs(clips, target, options.format, { captions: options.captions, audio: options.audio });
  if (options.signal?.aborted) throw new Error("Video export was canceled.");
  if (!await options.confirm(summary)) return null;
  if (options.signal?.aborted) throw new Error("Video export was canceled.");

  const temporaryDirectory = await mkdtemp(join(root, ".helstera-video-export-"));
  const temporaryOutput = join(temporaryDirectory, "output.mp4");
  return withVideoExportCleanup(temporaryDirectory, async () => {
    const snapshots = new Map<string, string>();
    const snapshotClips: ExportClip[] = [];
    for (const clip of clips) {
      let snapshot = snapshots.get(clip.sourcePath);
      if (!snapshot) {
        snapshot = join(temporaryDirectory, `source-${snapshots.size}`);
        const fingerprint = await fingerprintSource(clip.sourcePath, snapshot, options.signal);
        if (fingerprint !== fingerprints.get(clip.sourcePath)) throw new Error("A source video changed after confirmation. Review the project and try again.");
        snapshots.set(clip.sourcePath, snapshot);
      }
      const info = await options.inspect(snapshot, clip.inputFormat);
      if (!Number.isSafeInteger(info.durationMs) || info.durationMs < clip.endMs || info.hasAudio !== clip.hasAudio) throw new Error("A source video no longer matches its inspected metadata.");
      snapshotClips.push({ ...clip, sourcePath: snapshot });
    }
    await options.render(buildVideoExportArgs(snapshotClips, temporaryOutput, options.format, { captions: options.captions, audio: options.audio }), options.signal);
    if (options.signal?.aborted) throw new Error("Video export was canceled.");
    const output = await stat(temporaryOutput);
    if (!output.isFile() || output.size === 0) throw new Error("The exported video is empty.");
    await options.inspect(temporaryOutput, "mov");
    if (options.signal?.aborted) throw new Error("Video export was canceled.");
    // A hard link publishes the completed file atomically without replacing an existing file.
    await link(temporaryOutput, target);
    return { path: target };
  });
}
