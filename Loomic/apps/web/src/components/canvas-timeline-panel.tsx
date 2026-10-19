"use client";

import { Download, Film, Image as ImageIcon, Music, Pause, Play, Plus, Type, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { uploadFile } from "../lib/server-api";

type TimelinePanelProps = {
  excalidrawApi: any;
  open: boolean;
  onClose: () => void;
  accessToken: string;
  projectId: string;
};

type TimelineItem = {
  id: string;
  label: string;
  kind: "image" | "video" | "subtitle" | "audio";
  duration: number;
  trimStart: number;
  trimEnd: number;
  sourceUrl?: string;
};

function readItems(api: any): TimelineItem[] {
  return (api?.getSceneElements?.() ?? [])
    .filter((element: any) => !element.isDeleted && (element.type === "image" || element.customData?.isVideo === true || element.customData?.isSubtitle === true || element.customData?.isAudio === true))
    .map((element: any, index: number) => ({
      id: element.id,
      label: element.customData?.title?.slice(0, 32) || element.text?.slice(0, 32) || `${element.type === "image" ? "图片" : "视频"} ${index + 1}`,
      kind: element.customData?.isSubtitle === true ? "subtitle" : element.customData?.isVideo === true ? "video" : element.customData?.isAudio === true ? "audio" : "image",
      duration: Number(element.customData?.durationSeconds) || (element.customData?.isVideo ? 5 : 0),
      trimStart: Number(element.customData?.isSubtitle ? element.customData?.subtitleStart : element.customData?.trimStart) || 0,
      trimEnd: Number(element.customData?.isSubtitle ? element.customData?.subtitleEnd : element.customData?.trimEnd) || Number(element.customData?.durationSeconds) || (element.customData?.isVideo || element.customData?.isAudio ? 5 : element.customData?.isSubtitle ? 5 : 0),
      sourceUrl: element.customData?.isAudio ? element.customData?.audioUrl : undefined,
    }));
}

export function CanvasTimelinePanel({ excalidrawApi, open, onClose, accessToken, projectId }: TimelinePanelProps) {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [subtitle, setSubtitle] = useState("");
  const [playhead, setPlayhead] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  const totalDuration = Math.max(5, ...items.map((item) => item.kind === "video" || item.kind === "audio" || item.kind === "subtitle" ? item.trimEnd : 0));

  const refresh = useCallback(() => setItems(readItems(excalidrawApi)), [excalidrawApi]);

  useEffect(() => {
    if (!open || !excalidrawApi) return;
    refresh();
    const unsubscribe = excalidrawApi.onChange(refresh);
    return () => { if (typeof unsubscribe === "function") unsubscribe(); };
  }, [excalidrawApi, open, refresh]);

  useEffect(() => {
    if (!previewing) return;
    const timer = window.setInterval(() => {
      setPlayhead((value) => {
        const next = value + 0.1;
        if (next >= totalDuration) {
          setPreviewing(false);
          return 0;
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [previewing, totalDuration]);

  useEffect(() => {
    if (!open || !excalidrawApi) return;
    const elements = excalidrawApi.getSceneElements?.() ?? [];
    const nextElements = elements.map((element: any) => {
      if (!element.customData?.isSubtitle) return element;
      const customData = element.customData;
      const start = Number(customData.subtitleStart) || 0;
      const end = Number(customData.subtitleEnd) || 5;
      const visible = !previewing || (playhead >= start && playhead < end);
      const originalOpacity = Number(customData.previewOpacity) || Number(element.opacity) || 100;
      if (element.opacity === (visible ? originalOpacity : 0)) return element;
      return { ...element, opacity: visible ? originalOpacity : 0, customData: { ...customData, previewOpacity: originalOpacity } };
    });
    if (nextElements.some((element: any, index: number) => element !== elements[index])) {
      excalidrawApi.updateScene({ elements: nextElements, captureUpdate: "NEVER" });
    }
  }, [excalidrawApi, open, playhead, previewing]);

  const selectItem = useCallback((id: string) => {
    const element = excalidrawApi?.getSceneElements?.().find((candidate: any) => candidate.id === id);
    if (!element) return;
    excalidrawApi.updateScene({ appState: { selectedElementIds: { [id]: true } } });
    excalidrawApi.scrollToContent?.([element], { fitToContent: false, duration: 250 });
  }, [excalidrawApi]);

  const removeItem = useCallback((id: string) => {
    const elements = excalidrawApi?.getSceneElements?.() ?? [];
    excalidrawApi?.updateScene({ elements: elements.map((element: any) => element.id === id ? { ...element, isDeleted: true } : element), captureUpdate: "IMMEDIATELY" });
  }, [excalidrawApi]);

  const updateTrim = useCallback((id: string, key: "trimStart" | "trimEnd", value: number) => {
    const elements = excalidrawApi?.getSceneElements?.() ?? [];
    const element = elements.find((candidate: any) => candidate.id === id);
    if (!element) return;
    const current = element.customData ?? {};
    const nextStart = key === "trimStart" ? value : Number(current.trimStart) || 0;
    const nextEnd = key === "trimEnd" ? value : Number(current.trimEnd) || 5;
    if (nextStart >= nextEnd) return;
    excalidrawApi.updateScene({ elements: elements.map((candidate: any) => candidate.id === id ? { ...candidate, customData: { ...current, [key]: value } } : candidate), captureUpdate: "IMMEDIATELY" });
  }, [excalidrawApi]);

  const updateSubtitle = useCallback((id: string, key: "trimStart" | "trimEnd", value: number) => {
    const elements = excalidrawApi?.getSceneElements?.() ?? [];
    const element = elements.find((candidate: any) => candidate.id === id);
    if (!element) return;
    const current = element.customData ?? {};
    const start = key === "trimStart" ? value : Number(current.subtitleStart) || 0;
    const end = key === "trimEnd" ? value : Number(current.subtitleEnd) || 5;
    if (start >= end) return;
    excalidrawApi.updateScene({ elements: elements.map((candidate: any) => candidate.id === id ? { ...candidate, customData: { ...current, subtitleStart: start, subtitleEnd: end } } : candidate), captureUpdate: "IMMEDIATELY" });
  }, [excalidrawApi]);

  const applySubtitleStyle = useCallback((id: string, style: "bottom" | "title" | "emphasis") => {
    const elements = excalidrawApi?.getSceneElements?.() ?? [];
    const element = elements.find((candidate: any) => candidate.id === id);
    if (!element) return;
    const styles = {
      bottom: { x: 120, y: 520, fontSize: 28, strokeColor: "#ffffff", backgroundColor: "#111111" },
      title: { x: 120, y: 100, fontSize: 42, strokeColor: "#ffffff", backgroundColor: "transparent" },
      emphasis: { x: 120, y: 420, fontSize: 34, strokeColor: "#ffe066", backgroundColor: "transparent" },
    } as const;
    const next = styles[style];
    excalidrawApi.updateScene({ elements: elements.map((candidate: any) => candidate.id === id ? { ...candidate, ...next, customData: { ...(candidate.customData ?? {}), subtitleStyle: style } } : candidate), captureUpdate: "IMMEDIATELY" });
  }, [excalidrawApi]);

  const addSubtitle = useCallback(async () => {
    const text = subtitle.trim();
    if (!text || !excalidrawApi) return;
    const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
    const element = convertToExcalidrawElements([{
      type: "text",
      text,
      x: 120,
      y: 420,
      fontSize: 28,
      fontFamily: 1,
      textAlign: "center",
      verticalAlign: "middle",
      customData: { isSubtitle: true, title: text, subtitleStart: 0, subtitleEnd: 5 },
    } as any])[0];
    if (!element) return;
    excalidrawApi.updateScene({ elements: [...(excalidrawApi.getSceneElements?.() ?? []), element], captureUpdate: "IMMEDIATELY" });
    setSubtitle("");
  }, [excalidrawApi, subtitle]);

  const addAudio = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !excalidrawApi) return;
    try {
      const uploaded = await uploadFile(accessToken, file, projectId);
      const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
      const element = convertToExcalidrawElements([{
        type: "rectangle",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        opacity: 0,
        customData: {
          isAudio: true,
          title: file.name,
          audioUrl: uploaded.url,
          audioAssetId: uploaded.asset.id,
          durationSeconds: 5,
          trimStart: 0,
          trimEnd: 5,
        },
      } as any])[0];
      if (!element) return;
      excalidrawApi.updateScene({ elements: [...(excalidrawApi.getSceneElements?.() ?? []), element], captureUpdate: "IMMEDIATELY" });
      const audio = new Audio(uploaded.url);
      audio.addEventListener("loadedmetadata", () => {
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
        const elements = excalidrawApi.getSceneElements?.() ?? [];
        excalidrawApi.updateScene({
          elements: elements.map((candidate: any) => candidate.id === element.id ? {
            ...candidate,
            customData: { ...(candidate.customData ?? {}), durationSeconds: audio.duration, trimEnd: audio.duration },
          } : candidate),
          captureUpdate: "IMMEDIATELY",
        });
      }, { once: true });
    } catch (error) {
      console.error("[timeline] audio upload failed:", error);
    }
  }, [accessToken, excalidrawApi, projectId]);

  const exportProject = useCallback(() => {
    const elements = (excalidrawApi?.getSceneElements?.() ?? []).filter((element: any) => !element.isDeleted);
    const manifest = {
      format: "helstera-timeline-v1",
      exportedAt: new Date().toISOString(),
      durationSeconds: totalDuration,
      tracks: elements
        .filter((element: any) => element.type === "image" || element.customData?.isVideo || element.customData?.isSubtitle || element.customData?.isAudio)
        .map((element: any) => ({ id: element.id, type: element.customData?.isAudio ? "audio" : element.customData?.isSubtitle ? "subtitle" : element.customData?.isVideo ? "video" : "image", title: element.customData?.title ?? element.text ?? null, url: element.customData?.audioUrl ?? element.customData?.url ?? null, start: Number(element.customData?.subtitleStart ?? element.customData?.trimStart ?? 0), end: Number(element.customData?.subtitleEnd ?? element.customData?.trimEnd ?? element.customData?.durationSeconds ?? 0), text: element.customData?.isSubtitle ? element.text : undefined })),
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "helstera-timeline.json";
    link.click();
    URL.revokeObjectURL(url);
  }, [excalidrawApi, totalDuration]);

  const syncAudioPreview = useCallback((id: string, audio: HTMLAudioElement) => {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;
    if (audio.currentTime < item.trimStart || audio.currentTime >= item.trimEnd) audio.currentTime = item.trimStart;
    if (activeAudioId === id) {
      audio.pause();
      setActiveAudioId(null);
      return;
    }
    document.querySelectorAll<HTMLAudioElement>("audio[data-timeline-audio]").forEach((candidate) => candidate.pause());
    void audio.play().then(() => setActiveAudioId(id)).catch(() => setActiveAudioId(null));
  }, [activeAudioId, items]);

  if (!open) return null;

  return (
    <aside className="absolute bottom-16 left-4 right-4 z-30 max-w-3xl rounded-2xl border border-border/60 bg-background/95 p-3 shadow-2xl backdrop-blur-xl" aria-label="媒体时间线" aria-live="polite">
      <div className="flex items-center justify-between border-b border-border/60 pb-2">
        <div>
          <h2 className="text-xs font-medium text-foreground">媒体时间线</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">素材、字幕和裁剪参数会随项目自动保存</p>
        </div>
        <button ref={closeButtonRef} type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="关闭时间线"><X className="size-4" /></button>
      </div>
      <div className="mt-3 flex gap-2">
        <input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addSubtitle(); }} placeholder="输入字幕内容" className="h-8 min-w-0 flex-1 rounded-lg border border-border/60 bg-muted/40 px-2.5 text-xs outline-none focus:border-foreground/30" />
        <button type="button" onClick={() => void addSubtitle()} disabled={!subtitle.trim()} className="inline-flex h-8 items-center gap-1 rounded-lg bg-foreground px-2.5 text-xs text-background disabled:cursor-not-allowed disabled:opacity-40"><Plus className="size-3.5" />添加字幕</button>
        <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-border/60 px-2.5 text-xs text-foreground hover:bg-muted"><Upload className="size-3.5" />音频<input type="file" accept="audio/*" className="sr-only" onChange={(event) => void addAudio(event)} /></label>
        <button type="button" onClick={exportProject} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border/60 px-2.5 text-xs text-foreground hover:bg-muted"><Download className="size-3.5" />导出清单</button>
      </div>
      <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-2">
        <div className="flex items-center gap-2"><button type="button" onClick={() => setPreviewing((value) => !value)} className="flex size-7 items-center justify-center rounded-full bg-foreground text-background" aria-label={previewing ? "暂停预览" : "播放预览"}>{previewing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}</button><input aria-label="时间线播放头" type="range" min="0" max={totalDuration} step="0.1" value={playhead} onChange={(event) => { setPreviewing(false); setPlayhead(Number(event.target.value)); }} className="h-1 flex-1 accent-foreground" /><span className="w-20 text-right text-[10px] tabular-nums text-muted-foreground">{playhead.toFixed(1)} / {totalDuration.toFixed(1)}s</span></div>
        <div className="mt-1 flex justify-between px-9 text-[9px] text-muted-foreground"><span>0s</span><span>{(totalDuration / 2).toFixed(1)}s</span><span>{totalDuration.toFixed(1)}s</span></div>
      </div>
      {items.length === 0 ? (
        <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">添加图片或视频后会显示在这里</div>
      ) : (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {items.map((item, index) => (
            <div key={item.id} className="group relative min-w-40 rounded-xl border border-border/60 bg-muted/40 p-2">
              <button type="button" onClick={() => selectItem(item.id)} className="flex w-full items-center gap-2 text-left">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground">{item.kind === "video" ? <Film className="size-4" /> : item.kind === "subtitle" ? <Type className="size-4" /> : item.kind === "audio" ? <Music className="size-4" /> : <ImageIcon className="size-4" />}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs text-foreground">{index + 1}. {item.label}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{item.kind === "video" ? `${item.duration}s 视频` : item.kind === "audio" ? `${item.trimStart.toFixed(1)}s - ${item.trimEnd.toFixed(1)}s 音频` : item.kind === "subtitle" ? `${item.trimStart.toFixed(1)}s - ${item.trimEnd.toFixed(1)}s 字幕` : "图片素材"}</span></span>
                {item.kind === "video" && <Play className="size-3 text-muted-foreground" />}
              </button>
              {item.kind === "video" && <div className="mt-2 space-y-1"><div className="flex justify-between text-[10px] text-muted-foreground"><span>入点 {item.trimStart.toFixed(1)}s</span><span>出点 {item.trimEnd.toFixed(1)}s</span></div><input aria-label={`${item.label}入点`} type="range" min="0" max={Math.max(item.duration, 0.1)} step="0.1" value={item.trimStart} onChange={(event) => updateTrim(item.id, "trimStart", Number(event.target.value))} className="h-1 w-full accent-foreground" /><input aria-label={`${item.label}出点`} type="range" min="0" max={Math.max(item.duration, 0.1)} step="0.1" value={item.trimEnd} onChange={(event) => updateTrim(item.id, "trimEnd", Number(event.target.value))} className="h-1 w-full accent-foreground" /></div>}
              {item.kind === "subtitle" && <div className="mt-2 space-y-2"><div className="flex justify-between text-[10px] text-muted-foreground"><span>{item.trimStart.toFixed(1)}s</span><span>{item.trimEnd.toFixed(1)}s</span></div><input aria-label={`${item.label}字幕开始时间`} type="range" min="0" max="60" step="0.1" value={item.trimStart} onChange={(event) => updateSubtitle(item.id, "trimStart", Number(event.target.value))} className="h-1 w-full accent-foreground" /><input aria-label={`${item.label}字幕结束时间`} type="range" min="0" max="60" step="0.1" value={item.trimEnd} onChange={(event) => updateSubtitle(item.id, "trimEnd", Number(event.target.value))} className="h-1 w-full accent-foreground" /><div className="flex gap-1"><button type="button" onClick={() => applySubtitleStyle(item.id, "bottom")} className="rounded-md border px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted">底部</button><button type="button" onClick={() => applySubtitleStyle(item.id, "title")} className="rounded-md border px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted">标题</button><button type="button" onClick={() => applySubtitleStyle(item.id, "emphasis")} className="rounded-md border px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted">强调</button></div></div>}
              {item.kind === "audio" && <div className="mt-2 space-y-1"><div className="flex justify-between text-[10px] text-muted-foreground"><span>起点 {item.trimStart.toFixed(1)}s</span><span>终点 {item.trimEnd.toFixed(1)}s</span></div>{item.sourceUrl && <div className="flex items-center gap-2"><button type="button" onClick={(event) => syncAudioPreview(item.id, event.currentTarget.parentElement?.querySelector("audio")!)} className="flex size-6 items-center justify-center rounded-full bg-foreground text-background" aria-label={activeAudioId === item.id ? "暂停音频" : "播放音频"}>{activeAudioId === item.id ? <Pause className="size-3" /> : <Play className="size-3" />}</button><audio data-timeline-audio src={item.sourceUrl} preload="metadata" onPause={() => { if (activeAudioId === item.id) setActiveAudioId(null); }} onTimeUpdate={(event) => { if (event.currentTarget.currentTime >= item.trimEnd) { event.currentTarget.pause(); event.currentTarget.currentTime = item.trimStart; } }} /></div>}<input aria-label={`${item.label}音频开始时间`} type="range" min="0" max="60" step="0.1" value={item.trimStart} onChange={(event) => updateTrim(item.id, "trimStart", Number(event.target.value))} className="h-1 w-full accent-foreground" /><input aria-label={`${item.label}音频结束时间`} type="range" min="0" max="60" step="0.1" value={item.trimEnd} onChange={(event) => updateTrim(item.id, "trimEnd", Number(event.target.value))} className="h-1 w-full accent-foreground" /></div>}
              <button type="button" onClick={() => removeItem(item.id)} className="absolute right-1 top-1 hidden size-5 items-center justify-center rounded bg-background/90 text-muted-foreground hover:text-destructive group-hover:flex" aria-label={`删除${item.label}`}><X className="size-3" /></button>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
