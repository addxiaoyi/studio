"use client";

import React from "react";
import { AnimatedCounter } from "@/components/landing/animated-counter";
import { FadeUp } from "@/components/landing/motion";

interface StatItem {
  target: number;
  suffix: string;
  label: string;
  decimals?: boolean;
}

const STATS: StatItem[] = [
  { target: 10000, suffix: "+", label: "企业团队" },
  { target: 50, suffix: "+", label: "AI 模型集成" },
  { target: 99.95, suffix: "%", label: "服务可用性", decimals: true },
  { target: 24, suffix: "/7", label: "企业级支持" },
];

function StatCard({ stat, isLast }: { stat: StatItem; isLast: boolean }) {
  return (
    <>
      <FadeUp className="flex flex-col items-center gap-3">
        <span className="text-5xl md:text-6xl font-light text-foreground tabular-nums tracking-tight">
          <AnimatedCounter
            target={stat.target}
            suffix={stat.suffix}
            duration={stat.decimals ? 1800 : 2000}
          />
        </span>
        <span className="eyebrow">{stat.label}</span>
      </FadeUp>

      {!isLast && (
        <div
          className="hidden md:block h-12 w-px shrink-0"
          style={{ background: "oklch(var(--foreground) / 0.08)" }}
        />
      )}
    </>
  );
}

export function TrustBar() {
  return (
    <section className="py-24 md:py-32">
      <div className="max-w-5xl mx-auto px-6 flex flex-wrap items-center justify-center gap-8 md:gap-16">
        {STATS.map((stat, i) => (
          <StatCard key={stat.label} stat={stat} isLast={i === STATS.length - 1} />
        ))}
      </div>
    </section>
  );
}
