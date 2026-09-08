"use client";

import { FadeUp } from "@/components/landing/motion";
import type { Step } from "./steps-data";

/**
 * StepCard — a single onboarding step in the 4-up grid.
 * Glass card with a large editorial step number that fades into
 * the background, then the icon + title + description on top.
 */
export function StepCard({ step }: { step: Step }) {
  const Icon = step.icon;
  return (
    <FadeUp className="group relative">
      <div className="glass rounded-2xl p-8 h-full transition-all duration-500 hover:translate-y-[-2px]">
        <span
          className="block text-[4rem] font-extralight leading-none tracking-tighter text-foreground/10 mb-8 select-none"
          aria-hidden
        >
          {step.number}
        </span>

        <div className="mb-7">
          <Icon
            className="size-5 text-foreground/60"
            strokeWidth={1.5}
          />
        </div>

        <h3 className="text-base font-medium text-foreground mb-3 tracking-tight">
          {step.title}
        </h3>

        <p className="text-sm text-muted-foreground leading-relaxed font-light">
          {step.description}
        </p>
      </div>
    </FadeUp>
  );
}
