"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { HelsteraLogo } from "@/components/icons/helstera-logo";

export function PricingNav() {
  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="fixed inset-x-0 top-0 z-50 glass-strong border-b border-white/15"
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <HelsteraLogo className="size-7 text-foreground" />
          <span className="text-base font-medium tracking-tight">
            Helstera
          </span>
        </Link>

        <div className="flex items-center gap-1.5">
          <Link
            href="/login"
            className="inline-flex items-center px-3.5 h-8 text-sm text-muted-foreground hover:text-foreground transition-all duration-300"
          >
            登录
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center px-4 h-8 rounded-full bg-foreground text-background text-sm font-medium transition-all hover:scale-[1.02]"
          >
            免费开始
          </Link>
        </div>
      </nav>
    </motion.header>
  );
}
