"use client";
import { useEffect, useRef, useState } from "react";
import { Film, Sparkles } from "lucide-react";

type VideoBounds = { id: string; x: number; y: number; width: number; height: number; isDeleted?: boolean; customData?: { isVideo?: boolean } };
type SceneApi = {
  getSceneElements(): readonly VideoBounds[];
  getAppState(): { zoom?: { value: number }; scrollX?: number; scrollY?: number; selectedElementIds?: Record<string, boolean> };
  onChange(callback: () => void): (() => void) | void;
};

export function VideoActionsToolbar({ api, root, onAction }: { api: SceneApi | null; root: React.RefObject<HTMLDivElement | null>; onAction?: ((id: string, action: "timeline" | "ai") => void) | undefined }) {
  const [target, setTarget] = useState<{ id: string; left: number; top: number } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const surface = root.current;
    if (!api || !surface) return;
    let hovered: string | null = null;
    const update = () => {
      const state = api.getAppState(), zoom = state.zoom?.value ?? 1;
      const videos = api.getSceneElements().filter(element => !element.isDeleted && element.customData?.isVideo);
      const video = videos.find(element => element.id === hovered) ?? videos.find(element => state.selectedElementIds?.[element.id]);
      if (!video) { setTarget(null); return; }
      const bounds = surface.getBoundingClientRect();
      const x = (video.x + (state.scrollX ?? 0)) * zoom;
      const y = (video.y + (state.scrollY ?? 0)) * zoom;
      if (x + video.width * zoom < 0 || x > bounds.width || y + video.height * zoom < 0 || y > bounds.height) { setTarget(null); return; }
      // Keep hover actions outside the media so small videos can still be dragged.
      const toolbarY = y >= 116 ? y - 48 : y + video.height * zoom + 8;
      const next = { id: video.id, left: Math.max(8, Math.min(x + 8, bounds.width - 250)), top: Math.max(64, Math.min(toolbarY, bounds.height - 52)) };
      setTarget(prior => prior?.id === next.id && prior.left === next.left && prior.top === next.top ? prior : next);
    };
    const point = (event: PointerEvent) => {
      if (menu.current?.contains(event.target as Node)) return;
      const bounds = surface.getBoundingClientRect(), state = api.getAppState(), zoom = state.zoom?.value ?? 1;
      const x = (event.clientX - bounds.left) / zoom - (state.scrollX ?? 0), y = (event.clientY - bounds.top) / zoom - (state.scrollY ?? 0);
      hovered = [...api.getSceneElements()].reverse().find(element => !element.isDeleted && element.customData?.isVideo && x >= element.x && x <= element.x + element.width && y >= element.y && y <= element.y + element.height)?.id ?? null;
      update();
    };
    const leave = () => { if (!menu.current?.contains(document.activeElement)) { hovered = null; update(); } };
    surface.addEventListener("pointermove", point);
    surface.addEventListener("pointerleave", leave);
    const unsubscribe = api.onChange(update);
    update();
    return () => { surface.removeEventListener("pointermove", point); surface.removeEventListener("pointerleave", leave); if (typeof unsubscribe === "function") unsubscribe(); };
  }, [api, root]);
  if (!target || !onAction) return null;
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return <div ref={menu} role="group" aria-label="视频创作操作" style={{ left: target.left, top: target.top }} className="pointer-events-auto absolute z-40 flex max-w-[calc(100%-1rem)] flex-wrap gap-1 rounded-lg border border-border bg-background p-1 text-foreground shadow-lg" onPointerDown={stop} onPointerMove={stop} onClick={stop}>
    <button type="button" onClick={() => onAction(target.id, "timeline")} className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><Film className="size-3.5" aria-hidden="true" />加入时间线</button>
    <button type="button" onClick={() => onAction(target.id, "ai")} className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-xs text-background hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"><Sparkles className="size-3.5" aria-hidden="true" />让 AI 剪辑</button>
  </div>;
}
