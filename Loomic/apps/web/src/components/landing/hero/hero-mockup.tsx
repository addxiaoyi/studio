"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { Shield, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { scaleUp } from "@/components/landing/motion";

/**
 * HeroMockup — a floating glass device frame showcasing the product UI.
 * Pulled out of hero-section.tsx so it can be reused in demos, blog posts,
 * or a future interactive playground.
 */
function MockupCursor() {
  return (
    <motion.div
      className="absolute z-10 pointer-events-none will-change-transform"
      animate={{ x: [40, 120, 180, 60, 40], y: [30, 80, 40, 120, 30] }}
      transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="drop-shadow-md" aria-hidden="true">
        <path d="M1 1L6.5 14L8.5 8.5L14 6.5L1 1Z" className="fill-primary" />
      </svg>
      <div
        className="mt-0.5 ml-3 px-1.5 py-0.5 rounded text-[8px] font-medium whitespace-nowrap bg-primary text-primary-foreground"
      >
        AI
      </div>
    </motion.div>
  );
}

export function HeroMockup() {
  return (
    <motion.div
      variants={scaleUp}
      initial="hidden"
      animate="visible"
      transition={{ delay: 1.2 }}
      className="relative w-full max-w-5xl mx-auto mt-20 md:mt-28 will-change-transform"
      style={{ animation: "landing-hero-float 8s ease-in-out infinite" }}
    >
      {/* Atmospheric glow — two layered halos for richer depth */}
      <div
        className="absolute -inset-40 -z-10 rounded-full opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(ellipse at center, oklch(var(--primary) / 0.30) 0%, transparent 70%)",
        }}
      />
      <div
        className="absolute -inset-20 -z-10 rounded-full opacity-20 blur-2xl"
        style={{
          background:
            "radial-gradient(ellipse at center, oklch(var(--accent) / 0.40) 0%, transparent 60%)",
        }}
      />

      {/* Floating device frame — pure glass */}
      <div
        className={cn(
          "w-full rounded-3xl overflow-hidden aspect-video",
          "glass-strong",
        )}
      >
        {/* Window chrome */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-1.5">
            <span className="size-3 rounded-full bg-foreground/15" />
            <span className="size-3 rounded-full bg-foreground/15" />
            <span className="size-3 rounded-full bg-foreground/15" />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
            <Shield className="size-3" strokeWidth={1.5} />
            <span>Helstera · 企业工作区</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="size-3 text-muted-foreground" strokeWidth={1.5} />
            <span className="text-[10px] text-muted-foreground">8 位成员在线</span>
          </div>
        </div>

        {/* Canvas area */}
        <div className="relative w-full h-[calc(100%-3.25rem)]">
          <MockupCursor />
          <Image
            src="/images/showcase/showcase-12.jpg"
            alt="Helstera Canvas"
            width={1200}
            height={675}
            priority
            unoptimized
            className="w-full h-full object-cover"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 1024px"
          />
        </div>
      </div>
    </motion.div>
  );
}
