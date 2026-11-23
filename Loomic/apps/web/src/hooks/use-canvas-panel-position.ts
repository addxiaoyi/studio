import { useLayoutEffect, useState, type RefObject } from "react";

const EDGE_GAP = 16;

export function useCanvasPanelPosition(ref: RefObject<HTMLDivElement | null>, x: number, y: number) {
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const placePanel = () => {
      const bounds = panel.getBoundingClientRect();
      const left = Math.max(EDGE_GAP, Math.min(x, window.innerWidth - bounds.width - EDGE_GAP));
      const top = Math.max(EDGE_GAP, Math.min(y, window.innerHeight - bounds.height - EDGE_GAP));
      setPosition((current) => current.left === left && current.top === top ? current : { left, top });
    };
    placePanel();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(placePanel);
    observer?.observe(panel);
    window.addEventListener("resize", placePanel);
    return () => { observer?.disconnect(); window.removeEventListener("resize", placePanel); };
  }, [ref, x, y]);
  return position;
}
