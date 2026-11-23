"use client";

/**
 * FinalCTA — bottom of the landing page.
 *
 * Layout (top → bottom):
 *   1. <SectionHeader />          heading + sub
 *   2. <FinalCtaButtons />        primary + secondary buttons
 *   3. <FinalTrustStrip />        compliance badges
 *   4. <TrustedByStrip />         industry list
 *   5. <TestimonialCard /> × 3    customer quotes (grid)
 *
 * Testimonial copy lives in cta-final/testimonials-data.tsx.
 */

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { SectionHeader } from "@/components/landing/section-header";
import { ScrollReveal, fadeUp } from "@/components/landing/motion";


function FinalCtaButtons() {
  return (
    <ScrollReveal variants={fadeUp} className="flex flex-wrap items-center justify-center gap-3">
      <Link
        href="/register"
        className={cn(
          "group inline-flex items-center gap-2 rounded-full px-7 py-3 text-sm font-medium",
          "bg-foreground text-background",
          "transition-all duration-300 hover:scale-[1.02] active:scale-[0.99]",
        )}
      >
        注册并开始创作
        <ArrowRight
          className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5"
          strokeWidth={1.5}
        />
      </Link>
      <Link
        href="/contact-sales"
        className={cn(
          "group inline-flex items-center gap-2 rounded-full px-7 py-3 text-sm font-medium",
          "text-foreground glass-soft hover:glass transition-all duration-300",
        )}
      >
        联系与咨询
        <ArrowRight
          className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5"
          strokeWidth={1.5}
        />
      </Link>
    </ScrollReveal>
  );
}

function FinalTrustStrip() {
  const ITEMS = ["生成前确认费用", "查看任务记录", "保存本地副本"];
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-muted-foreground">
      {ITEMS.map((item, i) => (
        <span key={item} className="inline-flex items-center gap-1.5">
          {item}
          {i < ITEMS.length - 1 && <span className="opacity-30">·</span>}
        </span>
      ))}
    </div>
  );
}

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden py-32 md:py-40">
      {/* Background glow */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 100%, oklch(0.30 0.08 270 / 0.06) 0%, transparent 70%)",
        }}
      />

      <div className="max-w-6xl mx-auto px-6 space-y-20">
        <SectionHeader
          title="让设计团队跑在 AI 时代前面"
          subtitle="先建立一个项目，选择模型并确认费用，再开始生成。"
        />

        <FinalCtaButtons />
        <FinalTrustStrip />

      </div>
    </section>
  );
}
