"use client";

import { useEffect, useRef } from "react";

export function GradualBlur({ height = "6rem", autoHide = false, className = "" }: { height?: string; autoHide?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!autoHide || !ref.current) return;
    const root = ref.current;
    const scroller = root.parentElement;
    if (!scroller) return;
    const update = () => { root.style.opacity = scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 4 ? "1" : "0"; };
    update(); scroller.addEventListener("scroll", update, { passive: true });
    return () => scroller.removeEventListener("scroll", update);
  }, [autoHide]);
  return <div ref={ref} aria-hidden="true" className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 transition-opacity duration-300 ${className}`} style={{ height, background: "linear-gradient(to top, hsl(var(--background) / .95), transparent)" }} />;
}
