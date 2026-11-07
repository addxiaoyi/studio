"use client";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import type { AgentBrowserCursor } from "@helstera/shared";

export function AgentCursor({
  cursor,
  width,
  height,
}: { cursor: AgentBrowserCursor | null; width: number; height: number }) {
  const marker = useRef<SVGGElement>(null);
  const canvas = useRef<SVGSVGElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const resize = () =>
      setScale(width / Math.max(1, node.getBoundingClientRect().width));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [width, cursor?.visible]);
  useEffect(() => {
    if (!marker.current || !cursor) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const tween = gsap.to(marker.current, {
      x: cursor.x * width,
      y: cursor.y * height,
      duration: reduce ? 0 : 0.28,
      ease: "power2.out",
      overwrite: true,
    });
    return () => {
      tween.kill();
    };
  }, [cursor?.x, cursor?.y, cursor?.visible, width, height]);
  if (!cursor?.visible) return null;
  return (
    <svg
      ref={canvas}
      className="agent-browser-cursor"
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <g ref={marker}>
        <g transform={`scale(${scale})`}>
          <path
            d="M0 0 5 29 12 20 23 19Z"
            fill="var(--primary)"
            stroke="white"
            strokeWidth="2"
          />
          <rect
            x={cursor.x > 0.65 ? -126 : 18}
            y="22"
            width="126"
            height="26"
            rx="6"
            fill="var(--primary)"
          />
          <text
            x={cursor.x > 0.65 ? -118 : 26}
            y="40"
            fill="var(--primary-foreground)"
            fontSize="12"
            fontFamily="system-ui, sans-serif"
          >
            {cursor.label.slice(0, 9)}
          </text>
        </g>
      </g>
    </svg>
  );
}
