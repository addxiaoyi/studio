import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseVideoExportInput, type VideoExportInput } from "./video-export-request.js";
import { exportVideo } from "./video-export.js";
import type { VideoSourceInfo } from "./video-export-assets.js";
import type { ExportAudio, ExportCaption, ExportClip } from "./video-export-plan.js";
import { withVideoExportCleanup, type VideoExportResult } from "./video-export-cleanup.js";

type ExportDependencies = {
  assetDirectory: () => Promise<string>;
  checkTools: () => Promise<void>;
  confirm: (request: VideoExportInput, directory: string) => Promise<boolean>;
  inspect: (path: string, format: ExportClip["inputFormat"]) => Promise<VideoSourceInfo>;
  render: (args: readonly string[], signal?: AbortSignal) => Promise<unknown>;
  renderCaptions?: (request: VideoExportInput, directory: string) => Promise<ExportCaption[]>;
};

export function createVideoExportHandler(dependencies: ExportDependencies) {
  let running = false;
  return async (input: unknown): Promise<VideoExportResult | null> => {
    if (running) throw new Error("A video export is already running.");
    const request = parseVideoExportInput(input);
    if (request.captions?.length && !dependencies.renderCaptions) throw new Error("当前桌面版不支持字幕导出，请升级客户端。");
    running = true;
    try {
      const directory = await dependencies.assetDirectory();
      await dependencies.checkTools();
      if (!await dependencies.confirm(request, directory)) return null;
      const staging = await mkdtemp(join(directory, ".helstera-video-input-"));
      return await withVideoExportCleanup(staging, async () => {
        const assets = [];
        const clips = [];
        for (const [index, clip] of request.clips.entries()) {
          const assetId = randomUUID();
          const path = join(staging, `${index}.${clip.mimeType === "video/mp4" ? "mp4" : "webm"}`);
          await writeFile(path, Buffer.from(clip.bytes), { flag: "wx" });
          assets.push({ assetId, path, mimeType: clip.mimeType, durationMs: clip.endMs });
          clips.push({ clipId: randomUUID(), assetId, startMs: clip.startMs, endMs: clip.endMs, track: 0 });
        }
        const audio: ExportAudio[] = [];
        for (const [index, item] of (request.audio ?? []).entries()) {
          const inputFormat = ({ "audio/wav": "wav", "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/mp4": "mov" } as const)[item.mimeType as "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/mp4"];
          if (!inputFormat) throw new Error("背景音乐格式不受支持。");
          const extension = inputFormat === "mov" ? "m4a" : inputFormat;
          const path = join(staging, `audio-${index}.${extension}`);
          await writeFile(path, Buffer.from(item.bytes), { flag: "wx" });
          audio.push({ sourcePath: path, inputFormat, startMs: item.startMs, volume: item.volume });
        }
        const captions = dependencies.renderCaptions ? await dependencies.renderCaptions(request, staging) : [];
        const output = await exportVideo({
          project: { projectId: randomUUID(), title: "Video export", revision: 1, updatedAt: new Date().toISOString(), assets, clips, actions: [] },
          assetDirectory: directory,
          format: request.format,
          inspect: dependencies.inspect,
          confirm: async () => true,
          render: dependencies.render,
          ...(captions.length ? { captions } : {}),
          ...(audio.length ? { audio } : {}),
        });
        if (!output) throw new Error("Video export was unexpectedly declined after confirmation.");
        return output;
      });
    } finally {
      running = false;
    }
  };
}
