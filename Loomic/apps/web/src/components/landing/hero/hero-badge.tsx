"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { fadeUp } from "@/components/landing/motion";

/**
 * HeroBadge — frosted glass pill that announces the product positioning.
 * Lives at the very top of the hero, sets the tone before the headline.
 */
export function HeroBadge() {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      className={cn(
        "inline-flex items-center gap-3 rounded-full px-4 py-1.5 text-sm",
        "glass",
      )}
    >
      <span className="size-1.5 rounded-full bg-accent animate-pulse" />
      <span className="text-muted-foreground">
        企业级 AI 画布 · 品牌一致性保障
      </span>
      <span
        className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
        style={{
          background: "oklch(var(--accent) / 0.18)",
          color: "oklch(0.40 0.08 130)",
        }}
      >
        New
      </span>
    </motion.div>
  );
}
