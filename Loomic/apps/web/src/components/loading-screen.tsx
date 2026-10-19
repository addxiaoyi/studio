"use client";

import { HelsteraBrandMark } from "./helstera-brand-mark";

/**
 */
export function LoadingScreen() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="正在加载"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background/80 backdrop-blur-xl"
    >
      <div className="glass-strong rounded-3xl px-8 py-7 text-foreground">
        <HelsteraBrandMark size="hero" animated />
      </div>
      <span className="text-xs font-medium tracking-[0.18em] text-muted-foreground">HELSTERA STUDIO</span>
    </div>
  );
}
