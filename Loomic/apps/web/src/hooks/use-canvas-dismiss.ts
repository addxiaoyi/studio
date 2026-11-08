"use client";
import { useEffect, useRef } from "react";
type CanvasHitApi = {
  getSceneElements(): Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    isDeleted?: boolean;
    opacity?: number;
    angle?: number;
  }>;
  getAppState(): { scrollX: number; scrollY: number; zoom: { value: number } };
};
export function useCanvasBlankDismiss(
  open: boolean,
  api: CanvasHitApi | null,
  onDismiss: () => void,
) {
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  useEffect(() => {
    if (!open || !api) return;
    let press: { x: number; y: number; target: HTMLCanvasElement } | null =
      null;
    const down = (event: PointerEvent) => {
      press = null;
      if (
        event.button !== 0 ||
        !(event.target instanceof HTMLCanvasElement) ||
        !event.target.closest("[data-canvas-surface]")
      )
        return;
      const state = api.getAppState(),
        bounds = event.target.getBoundingClientRect(),
        zoom = state.zoom.value;
      const x = (event.clientX - bounds.left) / zoom - state.scrollX,
        y = (event.clientY - bounds.top) / zoom - state.scrollY;
      const hit = api.getSceneElements().some((element) => {
        if (element.isDeleted || element.opacity === 0) return false;
        const angle = element.angle ?? 0,
          c = Math.abs(Math.cos(angle)),
          s = Math.abs(Math.sin(angle));
        const width =
            Math.abs(element.width) * c + Math.abs(element.height) * s,
          height = Math.abs(element.height) * c + Math.abs(element.width) * s;
        const cx = element.x + element.width / 2,
          cy = element.y + element.height / 2;
        return (
          Math.abs(x - cx) <= width / 2 + 5 / zoom &&
          Math.abs(y - cy) <= height / 2 + 5 / zoom
        );
      });
      if (!hit)
        press = { x: event.clientX, y: event.clientY, target: event.target };
    };
    const up = (event: PointerEvent) => {
      const start = press;
      press = null;
      if (
        start &&
        event.target === start.target &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5
      )
        latest.current();
    };
    const cancel = () => {
      press = null;
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
    };
  }, [open, api]);
}
