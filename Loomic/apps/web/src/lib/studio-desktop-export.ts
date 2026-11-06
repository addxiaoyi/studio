import type { StudioClip, StudioCut } from "./studio-cut";
import { validateStudioCut } from "./studio-cut";
import { MAX_STUDIO_MEDIA_BYTES } from "./studio-media";
import type { StudioRuntime } from "./visualforge-runtime";
import { saveStudioExport, type StudioExport } from "./visualforge-storage";

type DesktopExport = { id: string; path: string; createdAt: string };
type ExportBridge = {
  exportVideo(input: { format: StudioCut["format"]; clips: Array<{ name: string; mimeType: string; bytes: ArrayBuffer; startMs: number; endMs: number }>; captions?: StudioCut["captions"]; audio?: Array<{ name: string; mimeType: string; bytes: ArrayBuffer; startMs: number; volume: number }> }): Promise<{ path: string; previewId?: string; cleanupWarnings?: string[]; previewWarning?: boolean } | null>;
  readExportPreview(id: string): Promise<ArrayBuffer>;
  listExportPreviews(): Promise<DesktopExport[]>;
};
export function desktopVideoBridge(): ExportBridge | undefined {
  const bridge = (window as Window & { electronAPI?: Partial<ExportBridge> }).electronAPI;
  if (!bridge?.exportVideo || !bridge.readExportPreview || !bridge.listExportPreviews) return undefined;
  return bridge as ExportBridge;
}

export async function exportStudioCut(runtime: StudioRuntime, cut: StudioCut) {
  validateStudioCut(cut);
  const bridge = desktopVideoBridge();
  if (!bridge) throw new Error("当前客户端不支持本机 FFmpeg 导出，请使用编辑器中的渲染导出。");
  const clips: Array<{ clip: StudioClip; file: File }> = [];
  let bytes = 0;
  for (const clip of cut.clips) {
    const file = await runtime.readMedia(clip.name);
    bytes += file.size;
    if (bytes > MAX_STUDIO_MEDIA_BYTES) throw new Error("本机快剪导出素材合计不能超过 250 MB。");
    clips.push({ clip, file });
  }
  const input = await Promise.all(clips.map(async ({ clip, file }) => ({
    name: clip.name, mimeType: file.type, bytes: await file.arrayBuffer(),
    startMs: Math.round(clip.start * 1000), endMs: Math.round(clip.end * 1000),
  })));
  const audio = await Promise.all((cut.audio ?? []).map(async (item) => {
    const file = await runtime.readMedia(item.assetName);
    bytes += file.size;
    if (bytes > MAX_STUDIO_MEDIA_BYTES) throw new Error("本机导出的视频和音乐合计不能超过 250 MB。");
    return { name: item.assetName, mimeType: file.type, bytes: await file.arrayBuffer(), startMs: item.startMs, volume: item.volume };
  }));
  return bridge.exportVideo({ format: cut.format, clips: input, ...(cut.captions?.length ? { captions: cut.captions } : {}), ...(audio.length ? { audio } : {}) });
}

export async function recoverDesktopExport(userId: string, entry: DesktopExport): Promise<StudioExport> {
  const bridge = desktopVideoBridge();
  if (!bridge) throw new Error("此客户端无法读取本机导出文件。");
  const blob = new Blob([await bridge.readExportPreview(entry.id)], { type: "video/mp4" });
  if (!blob.size) throw new Error("本机导出文件为空，请检查保存目录。");
  const output = { id: entry.id, name: entry.path.split(/[\\/]/).pop() || "video-export.mp4", blob, createdAt: Date.parse(entry.createdAt) || Date.now() };
  await saveStudioExport(userId, output);
  return output;
}
