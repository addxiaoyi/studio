"use client";

import { useEffect, useRef, useState } from "react";

export function Strands({ listening = false, energy = 0.3, className = "" }: { listening?: boolean; energy?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    const canvas = ref.current; const parent = canvas?.parentElement; if (!canvas || !parent) return;
    if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) { setFallback(true); return; }
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas.getContext("2d"); } catch { setFallback(true); return; }
    if (!ctx) { setFallback(true); return; }
    let raf = 0; let start = performance.now();
    const draw = (now: number) => { const w = canvas.width = Math.max(1, parent.clientWidth * devicePixelRatio); const h = canvas.height = Math.max(1, parent.clientHeight * devicePixelRatio); ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); ctx.clearRect(0,0,parent.clientWidth,parent.clientHeight); const t=(now-start)/1000; const amp=(listening ? .22+.12*Math.sin(t*3) : .12)+energy*.12; for(let n=0;n<3;n++){ctx.beginPath();ctx.strokeStyle=(["#d95b56","#4ecdc4","#6b8cff"][n] ?? "#6b8cff");ctx.globalAlpha=.55;ctx.lineWidth=1.5;for(let x=0;x<=parent.clientWidth;x+=4){const y=parent.clientHeight*.55+Math.sin(x*.018+t*(.8+n*.2)+n)*parent.clientHeight*amp*(1+n*.15);if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();}ctx.globalAlpha=1;raf=requestAnimationFrame(draw);}; raf=requestAnimationFrame(draw); return()=>cancelAnimationFrame(raf);
  }, [energy, listening]);
  return fallback
    ? <div className={`h-full w-full bg-[linear-gradient(120deg,rgba(217,91,86,.22),rgba(78,205,196,.16),rgba(107,140,255,.22))] ${className}`} aria-hidden="true" />
    : <canvas ref={ref} className={`h-full w-full ${className}`} aria-hidden="true" />;
}
