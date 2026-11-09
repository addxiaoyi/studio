import type { VirtualProject } from "../../vendor/visualforge/packages/browser-studio/src/types";
import { getBrowserStudioStoredPublicFile } from "../../vendor/visualforge/packages/browser-studio/src/opfs-public-files";
import { studioCutSource, cutFrames, STUDIO_FPS, type StudioCut } from "../../apps/web/src/lib/studio-cut";
import { canvasTimelineSource } from "../../apps/web/src/lib/canvas-timeline-source";
import type { CanvasTimeline } from "../../apps/web/src/lib/canvas-timeline";

const VIDEO_MIMES: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",gif:"image/gif" };
export function listStudioMedia(project: VirtualProject) {
  return Object.keys(project.publicFiles || {}).flatMap(name => {
    const mimeType = VIDEO_MIMES[name.split(".").pop()?.toLowerCase() || ""];
    return mimeType ? [{ name, mimeType }] : [];
  });
}

export async function readStudioMedia(project: VirtualProject, name: string): Promise<File> {
  const media = listStudioMedia(project).find(item => item.name === name);
  const stored = project.publicFiles?.[name];
  if (!media || stored === undefined) throw new Error("工程音视频素材不存在，请重新导入。");
  if (typeof stored === "object" && "type" in stored && stored.type === "stored") {
    if (!project.publicFileStorage) throw new Error("工程缺少本机素材存储位置。");
    const file = await getBrowserStudioStoredPublicFile({ storage: project.publicFileStorage, file: stored });
    return new File([file], name, { type: media.mimeType });
  }
  if (stored instanceof Uint8Array) return new File([new Uint8Array(stored)], name, { type: media.mimeType });
  throw new Error("此素材尚未落盘，请等待工程保存后重试。");
}

export function currentCompositionId() {
  const search = location.search;
  if (!search.startsWith("?/")) return null;
  const value = decodeURIComponent(search.slice(2)).split("?")[0]?.trim();
  return value || null;
}

export async function applyStudioCut(cut: StudioCut) {
  return installTimeline(studioCutSource(cut), cutFrames(cut), cut.format);
}

export async function installCanvasTimeline(timeline: CanvasTimeline, names: Record<string,string>, fingerprint: string) {
  return installTimeline(canvasTimelineSource(timeline, names), Math.ceil(timeline.duration * STUDIO_FPS), timeline.format, `Canvas-${fingerprint.slice(0,16)}`);
}

async function installTimeline(sourceCode: string, durationInFrames: number, format: StudioCut["format"], canvasCompositionId?: string) {
  const operations = window.remotion_browserStudio;
  if (!operations) throw new Error("请等待编辑器就绪。");
  const suffix = crypto.randomUUID().slice(0, 8);
  const compositionId = canvasCompositionId ?? `Cut-${suffix}`;
  const componentName = `LoomicCut${suffix}`;
  const element = {
    assets: [], dependencies: [], durationInFrames, initialProps: null,
    installationMode: "wrapped" as const, isCaptionStyle: false,
    slug: `loomic-cut-${suffix}`, displayName: canvasCompositionId ? "画布成片" : "快剪方案", sourceCode,
    dimensions: format === "portrait" ? { width: 720, height: 1280 } : { width: 1280, height: 720 },
  };
  const selectedCompositionId = currentCompositionId();
  const selectedCompositionFile = selectedCompositionId ? operations.getCompositionFile(selectedCompositionId) : null;
  const destination = !canvasCompositionId && selectedCompositionId && selectedCompositionFile
    ? { type: "current-composition" as const, compositionFile: selectedCompositionFile, compositionId: selectedCompositionId }
    : { type: "new-composition" as const, compositionFile: null };
  const targetCompositionId = destination.type === "current-composition" ? destination.compositionId : compositionId;
  const prepared = await operations.prepareElementInstall({ installationName: element.slug, element, destination });
  if (!prepared.success) throw new Error(`无法准备快剪时间线：${prepared.reason}`);
  const installed = await operations.insertElement({
    installationName: element.slug, element, expectedFileState: prepared.plan.expectedFileState,
    from: 0, position: null, overwriteExisting: false, undoRedoNavigation: null,
    captionTarget: null, compositionFile: prepared.plan.compositionFile, compositionId: targetCompositionId,
    newComposition: destination.type === "new-composition" ? { symbolicatedStack: null, options: {
      asset: null, newId: compositionId, componentName, componentImportPath: `./${componentName}`,
      folderName: null, parentName: null, newHeight: element.dimensions.height, newWidth: element.dimensions.width,
      newFps: STUDIO_FPS, newDurationInFrames: element.durationInFrames, canvasCapture: null,
    } } : null,
  });
  if (!installed.success) throw new Error(`无法加入快剪时间线：${"reason" in installed ? installed.reason : "工程发生变化，请重试。"}`);
  if (destination.type === "current-composition") {
    const metadata = await operations.updateCompositionMetadata({ idToUpdate: targetCompositionId,
      newDurationInFrames: element.durationInFrames, newFps: STUDIO_FPS,
      newWidth: element.dimensions.width, newHeight: element.dimensions.height,
      symbolicatedStack: null, undoRedoNavigation: null });
    if (!metadata.success) throw new Error("视频片段已添加，但合成时长更新失败，请检查时间线。");
  }
  if (destination.type === "new-composition") {
    const url = new URL(location.href);
    url.search = `/${compositionId}`;
    history.pushState({}, "Studio", url);
    window.dispatchEvent(new Event("remotion-pending-composition-selection"));
  }
  return targetCompositionId;
}
