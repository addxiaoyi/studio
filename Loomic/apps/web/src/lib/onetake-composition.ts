import type { TranscriptExportOptions } from "@helstera/shared";
import type { StudioRuntime, StudioSnapshot } from "./visualforge-runtime";

type ExportClip = { id: string; duration: number; options: Pick<TranscriptExportOptions, "aspect"> };

export async function oneTakeEditId(exportId: string, compositionId: string): Promise<string> {
  // Namespace by composition so reusing a finished video in another composition remains valid.
  const bytes = new TextEncoder().encode(JSON.stringify(["onetake", exportId, compositionId]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).slice(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x80;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function applyOneTakeExport(runtime: StudioRuntime, preview: StudioSnapshot, output: ExportClip, filename: string): Promise<void> {
  const current = await runtime.snapshot();
  const id = await oneTakeEditId(output.id, preview.compositionId);
  if (current.compositionId !== preview.compositionId) throw new Error("当前合成已改变，请重新预览替换。");
  // A successful mutation changes the revision; recognize it before rejecting a retry.
  if (current.appliedEdits?.includes(id)) return;
  if (current.revision !== preview.revision) throw new Error("当前合成已改变，请重新预览替换。");
  const format = output.options.aspect === "original" ? preview.format : output.options.aspect;
  await runtime.applyEdit({ id, compositionId: preview.compositionId, revision: preview.revision, replaceVideo: true,
    cut: { format, clips: [{ id, name: filename, start: 0, end: output.duration, duration: output.duration }], captions: [], audio: [] } });
}
