"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { fadeUp } from "@/components/landing/motion";

/**
 * Hook to read the CTA delay exposed by HeroHeadline via a hidden data-attr.
 * Lets each child of the hero section drive its own animation timing
 * without prop-drilling.
 */
function useCtaDelay(defaultMs: number): number {
  const [delay, setDelay] = useState(defaultMs);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>("[data-cta-delay]");
    if (!el) return;
    const raw = el.dataset.ctaDelay;
    if (raw) setDelay(Number.parseInt(raw, 10) * 1000);
  }, []);
  return delay;
}

/**
 * HeroCtas — primary + secondary calls to action.
 * The animation delay is read from a hidden data-attr placed by
 * HeroHeadline so the CTAs fade in *after* the headline.
 */
export function HeroCtas() {
  const delay = useCtaDelay(1600);

  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      transition={{ delay: delay / 1000 }}
      className="mt-14 flex flex-wrap items-center justify-center gap-3"
    >
      <Link
        href="/register"
        className={cn(
          "group inline-flex items-center px-7 py-3 rounded-full text-sm font-medium",
          "bg-foreground text-background",
          "transition-all duration-300 hover:scale-[1.02] active:scale-[0.99]",
        )}
      >
        免费开始试用
        <ArrowRight
          className="ml-2 size-3.5 transition-transform duration-300 group-hover:translate-x-0.5"
          strokeWidth={1.5}
        />
      </Link>
      <Link
        href="/pricing"
        className={cn(
          "group inline-flex items-center px-7 py-3 rounded-full text-sm font-medium",
          "text-foreground glass-soft hover:glass transition-all duration-300",
        )}
      >
        查看企业方案
        <ArrowRight
          className="ml-2 size-3.5 transition-transform duration-300 group-hover:translate-x-0.5"
          strokeWidth={1.5}
        />
      </Link>
    </motion.div>
  );
}
