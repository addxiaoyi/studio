"use client";

/**
 * HeroSection — top of the landing page.
 *
 * Layout, in order from top to bottom:
 *   1. <HeroBadge />            small glass pill
 *   2. <HeroHeadline />         editorial headline + subtitle + body
 *   3. <HeroCtas />             primary + secondary buttons
 *   4. <HeroTrustStrip />       compliance badges
 *   5. <HeroMockup />           floating glass device preview
 *   6. <ScrollIndicator />      pulsing chevron (shared component)
 *
 * Each child is independently styled and animated; this file is just
 * the orchestration + the layout container.
 */

import { HeroBadge } from "./hero/hero-badge";
import { HeroHeadline } from "./hero/hero-headline";
import { HeroCtas } from "./hero/hero-ctas";
import { HeroTrustStrip } from "./hero/hero-trust-strip";
import { HeroMockup } from "./hero/hero-mockup";
import { ScrollIndicator } from "./shared/scroll-indicator";
import { ScrollProgress } from "./shared/scroll-progress";

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center pt-32 md:pt-40 pb-32 overflow-hidden">
      {/* ── Scroll progress bar (top edge, glass) ────────────── */}
      <ScrollProgress />

      {/* ── Background: 3 large soft color fields drifting slowly ─────── */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <BackgroundOrb
          position="-top-1/4 right-[-10%] w-[70vw] h-[70vw] opacity-40"
          gradient="oklch(0.82 0.14 130 / 0.12)"
          animation="landing-gradient-drift-1 20s ease-in-out infinite alternate"
        />
        <BackgroundOrb
          position="bottom-[-15%] left-[-10%] w-[60vw] h-[60vw] opacity-30"
          gradient="oklch(0.30 0.08 270 / 0.10)"
          animation="landing-gradient-drift-2 24s ease-in-out infinite alternate"
        />
        <BackgroundOrb
          position="top-1/3 left-1/2 -translate-x-1/2 w-[50vw] h-[50vw] opacity-30"
          gradient="oklch(0.78 0.05 60 / 0.10)"
          animation="landing-gradient-drift-3 28s ease-in-out infinite alternate"
        />

        {/* Editorial grid lines — vertical hairlines on left & right edges */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-7xl px-6 pointer-events-none"
        >
          <div className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-foreground/5 to-transparent" />
          <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-foreground/5 to-transparent" />
        </div>

        {/* Crosshair marker (top-left) — adds editorial / tech feel */}
        <div
          aria-hidden
          className="absolute top-24 left-6 hidden lg:flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/30 font-light"
        >
          <span className="size-1.5 rounded-full bg-foreground/15" />
          HELSTERA · 01
        </div>

        {/* Crosshair marker (top-right) */}
        <div
          aria-hidden
          className="absolute top-24 right-6 hidden lg:flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/30 font-light"
        >
          ENTERPRISE EDITION
          <span className="size-1.5 rounded-full bg-foreground/15" />
        </div>
      </div>

      {/* ── Content (centered column with generous whitespace) ─────────── */}
      <div className="flex flex-col items-center text-center px-6 max-w-3xl mx-auto w-full">
        <HeroBadge />
        <HeroHeadline />
        <HeroCtas />
        <HeroTrustStrip />
        <HeroMockup />
      </div>

      <ScrollIndicator />
    </section>
  );
}

// ── Local helper ──────────────────────────────────────────────

function BackgroundOrb({
  position,
  gradient,
  animation,
}: {
  position: string;
  gradient: string;
  animation: string;
}) {
  return (
    <div
      className={`absolute rounded-full will-change-transform ${position}`}
      style={{
        background: `radial-gradient(ellipse at center, ${gradient} 0%, transparent 65%)`,
        animation,
      }}
    />
  );
}
