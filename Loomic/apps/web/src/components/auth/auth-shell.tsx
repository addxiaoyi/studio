"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

import { HelsteraLogo } from "@/components/icons/helstera-logo";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.12, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
} as any;

interface AuthShellProps {
  title: string;
  description: string;
  features: string[];
  children: ReactNode;
}

export function AuthShell({
  title,
  description,
  features,
  children,
}: AuthShellProps) {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand panel — dark glass */}
      <aside
        aria-label="品牌介绍"
        className="relative hidden overflow-hidden bg-foreground px-16 text-background lg:flex lg:w-1/2 lg:flex-col lg:justify-center"
      >
        <div
          className="pointer-events-none absolute -left-1/4 -top-1/4 h-[80%] w-[80%] rounded-full blur-[100px]"
          style={{
            background: "oklch(var(--primary) / 0.25)",
          }}
        />
        <div
          className="pointer-events-none absolute -bottom-1/4 -right-1/4 h-[60%] w-[60%] rounded-full blur-[100px]"
          style={{
            background: "oklch(1 0 0 / 0.05)",
          }}
        />

        <motion.div initial="hidden" animate="visible" className="relative z-10 max-w-md">
          <motion.div
            variants={fadeUp}
            custom={0}
            className="mb-10 flex items-center gap-3"
          >
            <HelsteraLogo className="size-12 rounded" />
            <span className="text-2xl font-medium tracking-tight">Helstera</span>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            custom={1}
            className="text-3xl md:text-4xl font-medium tracking-tight leading-tight mb-5"
          >
            {title}
          </motion.h1>

          <motion.p
            variants={fadeUp}
            custom={2}
            className="mb-12 max-w-md text-base text-background/60 font-light leading-relaxed"
          >
            {description}
          </motion.p>

          <ul className="space-y-4">
            {features.map((text, index) => (
              <motion.li
                key={text}
                variants={fadeUp}
                custom={index + 3}
                className="flex items-start gap-3 text-sm text-background/70 font-light"
              >
                <span className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                {text}
              </motion.li>
            ))}
          </ul>
        </motion.div>
      </aside>

      {/* Form panel — wrapped in <main> for landmark structure */}
      <main className="flex w-full items-center justify-center px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          {children}
        </div>
      </main>
    </div>
  );
}
