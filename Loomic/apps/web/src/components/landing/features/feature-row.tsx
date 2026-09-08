"use client";

import { ScrollReveal } from "@/components/landing/motion";
import { cn } from "@/lib/utils";
import type { FeatureEntry } from "./features-data";

/**
 * FeatureRow — a single left/right alternating feature row.
 * Drives the layout, the eyebrow + title + description + metric stack
 * on one side, and a glass-framed visual on the other.
 */
export function FeatureRow({ entry }: { entry: FeatureEntry }) {
  const Icon = entry.icon;

  const text = (
    <ScrollReveal variants={entry.textVariants} className="flex flex-col gap-6 max-w-md">
      <div className="flex items-center gap-3">
        <Icon className="size-4 text-muted-foreground" strokeWidth={1.5} />
        <span className="eyebrow">{entry.metric?.label ?? "Feature"}</span>
      </div>

      <h3 className="display-sm text-foreground">{entry.title}</h3>

      <p className="body-relaxed">{entry.description}</p>

      {entry.metric && (
        <div className="mt-4 flex items-baseline gap-3">
          <span className="text-4xl font-light text-foreground tracking-tight">
            {entry.metric.value}
          </span>
        </div>
      )}
    </ScrollReveal>
  );

  const visual = (
    <ScrollReveal variants={entry.visualVariants} className="relative">
      <div className="glass rounded-[1.5rem] p-4 backdrop-blur-2xl">
        <div className="rounded-2xl overflow-hidden shadow-glass">{entry.visual}</div>
      </div>
    </ScrollReveal>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-center">
      {entry.reversed ? (
        <>
          {visual}
          {text}
        </>
      ) : (
        <>
          {text}
          {visual}
        </>
      )}
    </div>
  );
}

export function FeatureRowDivider() {
  return (
    <div className="flex items-center justify-center">
      <div
        className="w-12 h-px"
        style={{ background: "oklch(var(--foreground) / 0.10)" }}
      />
    </div>
  );
}
