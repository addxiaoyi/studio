"use client";

import { Download, Film, Image as ImageIcon, Music, Plus, Type, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { uploadFile } from "../lib/server-api";
import { OperationStatus, type OperationStatusKind } from "./operation-status";
import { useCanvasBlankDismiss } from "../hooks/use-canvas-dismiss";
import { useFloatingPanel } from "../hooks/use-floating-panel";
import { inspectCanvasMedia } from "../lib/canvas-media-file";
import { canvasTimelineManifest, readCanvasTimeline, validateCanvasTimeline, type CanvasTimelineItem } from "../lib/canvas-timeline";
import { CanvasTimelinePreview } from "./canvas/timeline-preview";

type TimelinePanelProps = {
  excalidrawApi: any; open: boolean; onClose(): void; triggerRef?: React.RefObject<HTMLButtonElement | null>;
  accessToken: string; projectId: string; canvasId?: string;
  onEditVideo?: ((elementId: string) => void) | undefined;
  onCreateVideo?: (() => Promise<void>) | undefined;
};

export function CanvasTimelinePanel({ excalidrawApi, open, onClose, triggerRef, accessToken, projectId, canvasId, onEditVideo, onCreateVideo }: TimelinePanelProps) {
  const [timeline, setTimeline] = useState(() => readCanvasTimeline([], {}, canvasId));
  const [subtitle, setSubtitle] = useState("");
  const [exportStatus, setExportStatus] = useState<OperationStatusKind>("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const [audioError, setAudioError] = useState(""), [audioBusy, setAudioBusy] = useState(false), [creating, setCreating] = useState(false);
  const audioUpload = useRef<{ file: File; uploaded?: Awaited<ReturnType<typeof uploadFile>> } | null>(null);
  const audioLock = useRef(false), audioAbort = useRef<AbortController | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null), wasOpenRef = useRef(false), closedOnCanvas = useRef(false);
  const panel = useFloatingPanel(open, "bottom");
  useCanvasBlankDismiss(open, excalidrawApi, () => { closedOnCanvas.current = true; onClose(); });
  const items = timeline.items, totalDuration = timeline.duration;
  const refresh = useCallback(() => setTimeline(readCanvasTimeline(excalidrawApi?.getSceneElements?.() ?? [], excalidrawApi?.getFiles?.() ?? {}, canvasId)), [excalidrawApi, canvasId]);
  useEffect(() => {
    if (!open || !excalidrawApi) return;
    refresh(); const unsubscribe = excalidrawApi.onChange(refresh);
    return () => { if (typeof unsubscribe === "function") unsubscribe(); };
  }, [excalidrawApi, open, refresh]);
  useEffect(() => { if (open) closeButtonRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (open) wasOpenRef.current = true;
    else if (wasOpenRef.current) { wasOpenRef.current = false; if (!closedOnCanvas.current) triggerRef?.current?.focus(); closedOnCanvas.current = false; }
  }, [open, triggerRef]);
  useEffect(() => () => audioAbort.current?.abort(), [projectId]);

  function changeItem(id: string, values: Record<string, unknown>) {
    const elements = excalidrawApi?.getSceneElements?.() ?? [];
    excalidrawApi?.updateScene({ elements: elements.map((element: any) => element.id === id ? { ...element, version: (element.version ?? 0) + 1,
      versionNonce: Math.floor(Math.random() * 2_000_000_000), updated: Date.now(), customData: { ...element.customData, ...values } } : element), captureUpdate: "IMMEDIATELY" });
    refresh();
  }
  function selectItem(id: string) {
    const element = excalidrawApi?.getSceneElements?.().find((candidate: any) => candidate.id === id); if (!element) return;
    excalidrawApi.updateScene({ appState: { selectedElementIds: { [id]: true } } }); excalidrawApi.scrollToContent?.([element], { fitToContent: false });
  }
  function removeItem(id: string) {
    const elements = excalidrawApi?.getSceneElements?.() ?? [];
    excalidrawApi?.updateScene({ elements: elements.map((element: any) => element.id === id ? { ...element, isDeleted: true } : element), captureUpdate: "IMMEDIATELY" }); refresh();
  }
  function updateTrim(item: CanvasTimelineItem, edge: "start" | "end", value: number) {
    const start = edge === "start" ? value : item.trimStart, end = edge === "end" ? value : item.trimEnd;
    if (!Number.isFinite(value) || start < 0 || start >= end) return;
    if (item.kind !== "subtitle" && end > item.duration) return;
    changeItem(item.id, item.kind === "subtitle" ? { subtitleStart: start, subtitleEnd: end } : { trimStart: start, trimEnd: end });
  }
  function applySubtitleStyle(id: string, style: "bottom" | "title" | "emphasis") {
    const elements = excalidrawApi?.getSceneElements?.() ?? [];
    const visual = elements.find((item: any) => !item.isDeleted && (item.type === "image" || item.customData?.isVideo));
    const width = visual?.width || 1280, height = visual?.height || 720;
    const x = (visual?.x || 0) + width * 0.05, y = (visual?.y || 0) + height * (style === "title" ? 0.08 : style === "emphasis" ? 0.7 : 0.85);
    excalidrawApi.updateScene({ elements: elements.map((item: any) => item.id === id ? { ...item, x, y, width: width * 0.9, fontSize: Math.max(16, height * 0.05), textAlign: "center", customData: { ...item.customData, subtitleStyle: style } } : item), captureUpdate: "IMMEDIATELY" }); refresh();
  }
  async function addSubtitle() {
    if (!subtitle.trim() || !excalidrawApi) return;
    try {
      const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
      const element = convertToExcalidrawElements([{ type: "text", text: subtitle.trim(), x: 0, y: 0, fontSize: 28, fontFamily: 1,
        textAlign: "center", customData: { isSubtitle: true, title: subtitle.trim(), subtitleStart: 0, subtitleEnd: Math.min(totalDuration || 5, 5), subtitleStyle: "bottom" } }])[0];
      if (!element) throw new Error("字幕未能加入画布，请重试。");
      excalidrawApi.updateScene({ elements: [...excalidrawApi.getSceneElements(), element], captureUpdate: "IMMEDIATELY" });
      applySubtitleStyle(element.id, "bottom"); setSubtitle("");
    } catch (cause) { setExportError(cause instanceof Error ? cause.message : "字幕添加失败。"); }
  }
  async function uploadAudio(file: File) {
    if (audioLock.current || !excalidrawApi) return;
    if (!file.type.startsWith("audio/")) { setAudioError("请选择音频文件。"); return; }
    if (file.size > 25 * 1024 * 1024) { setAudioError("音频不能超过 25 MB，请压缩后上传。"); return; }
    audioLock.current = true; setAudioBusy(true); setAudioError("");
    const abort = new AbortController(); audioAbort.current = abort;
    const pending = audioUpload.current?.file === file ? audioUpload.current : { file };
    audioUpload.current = pending;
    try {
      pending.uploaded ??= await uploadFile(accessToken, file, projectId, "timeline-audio");
      abort.signal.throwIfAborted();
      const info = await inspectCanvasMedia(file, abort.signal);
      const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
      abort.signal.throwIfAborted();
      const element = convertToExcalidrawElements([{ type: "rectangle", x: 0, y: 0, width: 1, height: 1, opacity: 0,
        customData: { isAudio: true, title: file.name, audioUrl: pending.uploaded.url, audioAssetId: pending.uploaded.asset.id,
          durationSeconds: info.duration, trimStart: 0, trimEnd: info.duration, timelineStart: 0, timelineVolume: 1 } }])[0];
      if (!element) throw new Error("音轨未能加入画布，请重试。");
      excalidrawApi.updateScene({ elements: [...excalidrawApi.getSceneElements(), element], captureUpdate: "IMMEDIATELY" });
      audioUpload.current = null; refresh();
    } catch (cause) { if (!abort.signal.aborted) setAudioError(cause instanceof Error ? cause.message : "音频上传失败，已保留所选文件，可重试。"); }
    finally { audioLock.current = false; if (!abort.signal.aborted) setAudioBusy(false); }
  }
  function chooseAudio(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadAudio(file);
  }
  function retryAudio() { if (audioUpload.current) void uploadAudio(audioUpload.current.file); }
  function exportManifest() {
    setExportStatus("running"); setExportError(null);
    try {
      const current = readCanvasTimeline(excalidrawApi.getSceneElements(), excalidrawApi.getFiles?.() ?? {}, canvasId);
      const blob = new Blob([JSON.stringify(canvasTimelineManifest(current), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = "helstera-timeline.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus("success");
    } catch (cause) { setExportError(cause instanceof Error ? cause.message : "导出清单失败。"); setExportStatus("error-retryable"); }
  }
  async function createVideo() {
    if (!onCreateVideo || creating) return;
    setCreating(true); setExportError(null);
    try { validateCanvasTimeline(timeline); await onCreateVideo(); }
    catch (cause) { setExportError(cause instanceof Error ? cause.message : "无法准备成片，请重试。"); }
    finally { setCreating(false); }
  }
  if (!panel.present) return null;
  return <aside ref={panel.ref} aria-hidden={!open} inert={!open} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }} className="canvas-timeline-panel absolute bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-4 right-4 z-30 max-h-[min(72dvh,680px)] max-w-3xl overflow-y-auto rounded-2xl border border-border bg-background p-3 shadow-xl sm:bottom-16" aria-label="媒体时间线">
    <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background pb-2"><div><h2 className="text-sm font-medium">媒体时间线</h2><p className="mt-0.5 text-xs text-muted-foreground">画面按顺序播放；字幕与音轨使用同一时间轴，修改随画布保存</p></div><button ref={closeButtonRef} type="button" onClick={onClose} className="flex size-9 items-center justify-center rounded-lg hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-label="关闭时间线"><X className="size-4"/></button></div>
    <div className="mt-3 flex flex-wrap items-center gap-2"><input aria-label="字幕内容" value={subtitle} onChange={event => setSubtitle(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void addSubtitle(); }} placeholder="输入字幕内容" className="h-10 min-w-0 basis-full rounded-lg border bg-background px-3 text-base focus-visible:ring-2 focus-visible:ring-ring sm:flex-1 sm:basis-auto sm:text-sm"/><button type="button" onClick={addSubtitle} disabled={!subtitle.trim()} className="flex min-h-10 items-center gap-1 rounded-lg border px-3 text-sm disabled:opacity-40"><Plus className="size-4"/>添加字幕</button><label className="flex min-h-10 cursor-pointer items-center gap-1 rounded-lg border px-3 text-sm focus-within:ring-2 focus-within:ring-ring"><Upload className="size-4"/>{audioBusy ? "正在上传音频…" : "音频"}<input aria-label="上传音频" disabled={audioBusy} type="file" accept="audio/*" className="sr-only" onChange={chooseAudio}/></label>
      {onCreateVideo && <button type="button" onClick={createVideo} disabled={creating || !items.length} className="min-h-10 rounded-lg bg-foreground px-3 text-sm text-background disabled:opacity-40">{creating ? "正在保存时间线…" : "创建成片"}</button>}
      <button type="button" onClick={exportManifest} className="flex min-h-10 items-center gap-1 rounded-lg border px-3 text-sm"><Download className="size-4"/>导出清单</button></div>
    {audioError && <div role="alert" className="mt-2 text-sm text-destructive">{audioError}<button type="button" onClick={retryAudio} disabled={audioBusy} className="ml-3 min-h-9 underline">重试音频上传</button></div>}
    {exportError && <p role="alert" className="mt-2 text-sm text-destructive">{exportError}</p>}
    <OperationStatus status={exportStatus} label="时间线清单" {...(exportStatus === "success" ? { detail: "已发起清单下载，请检查浏览器下载记录。成片请使用创建成片。" } : {})}/>
    {open && items.length > 0 && <CanvasTimelinePreview timeline={timeline} token={accessToken}/>}
    {!items.length ? <p className="py-6 text-center text-sm text-muted-foreground">添加图片或视频后会显示在这里</p> : <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{items.map((item, index) => <div key={item.id} className="relative min-w-48 rounded-xl border bg-muted/20 p-3">
      <button type="button" onClick={() => selectItem(item.id)} aria-label={`选择${item.title}`} className="flex min-h-10 w-full items-center gap-2 pr-6 text-left focus-visible:ring-2 focus-visible:ring-ring"><span aria-hidden="true">{item.kind === "video" ? <Film className="size-4"/> : item.kind === "audio" ? <Music className="size-4"/> : item.kind === "subtitle" ? <Type className="size-4"/> : <ImageIcon className="size-4"/>}</span><span className="min-w-0 flex-1"><span className="block max-w-48 truncate text-sm" title={item.title}>{index + 1}. {item.title}</span><span className="block text-xs text-muted-foreground">{item.start.toFixed(1)}s · {(item.trimEnd - item.trimStart).toFixed(1)}s</span></span></button>
      {item.kind === "video" && onEditVideo && <button type="button" onClick={() => onEditVideo(item.id)} aria-label={`让 AI 剪辑${item.title}`} className="mt-2 min-h-9 w-full rounded-md border px-3 text-xs">让 AI 剪辑</button>}
      {item.kind === "image" ? <label className="mt-2 block text-xs">展示秒数<input type="number" min="0.1" max="7200" step="0.1" value={item.duration} onChange={event => { const seconds = Number(event.target.value); if (seconds > 0 && seconds <= 7200) changeItem(item.id, { timelineDuration: seconds, trimStart: 0, trimEnd: seconds }); }} className="ml-2 w-20 rounded border bg-background p-1 text-base"/></label> : <div className="mt-2 space-y-2">
        <div className="flex justify-between text-xs"><span>{item.trimStart.toFixed(1)}s</span><span>{item.trimEnd.toFixed(1)}s</span></div>
        {(["start", "end"] as const).map(edge => <input key={edge} aria-label={`${item.title}${item.kind === "subtitle" ? "字幕" : item.kind === "audio" ? "音频" : ""}${edge === "start" ? item.kind === "video" ? "入点" : "开始时间" : item.kind === "video" ? "出点" : "结束时间"}`} type="range" min={0} max={item.kind === "subtitle" ? Math.max(totalDuration, item.trimEnd) : item.duration} step="0.1" value={edge === "start" ? item.trimStart : item.trimEnd} onChange={event => updateTrim(item, edge, Number(event.target.value))} className="w-full"/>)}
      </div>}
      {item.kind === "subtitle" && <div className="mt-2 flex gap-1">{([['bottom','底部'],['title','标题'],['emphasis','强调']] as const).map(([style,label]) => <button key={style} type="button" onClick={() => applySubtitleStyle(item.id, style)} className="min-h-9 rounded-md border px-2 text-xs focus-visible:ring-2">{label}</button>)}</div>}
      {item.kind === "audio" && <div className="mt-2 space-y-2"><label className="block text-xs">音量 {Math.round(item.volume * 100)}%<input aria-label={`${item.title}音量`} type="range" min="0" max="1" step="0.01" value={item.volume} onChange={event => changeItem(item.id, { timelineVolume: Number(event.target.value) })} className="w-full"/></label><label className="block text-xs">时间线起点<input aria-label={`${item.title}时间线起点`} type="number" min="0" step="0.1" value={item.start} onChange={event => { const start = Number(event.target.value); if (Number.isFinite(start) && start >= 0) changeItem(item.id, { timelineStart: start }); }} className="ml-2 w-20 rounded border bg-background p-1 text-base"/></label></div>}
      <button type="button" onClick={() => removeItem(item.id)} className="absolute right-1 top-1 flex size-8 items-center justify-center rounded hover:text-destructive focus-visible:ring-2" aria-label={`删除${item.title}`}><X className="size-4"/></button>
    </div>)}</div>}
  </aside>;
}
