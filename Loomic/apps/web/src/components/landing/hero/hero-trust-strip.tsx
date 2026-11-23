"use client";

import { Shield } from "lucide-react";
import { motion } from "framer-motion";
import { fadeUp } from "@/components/landing/motion";

/**
 * HeroTrustStrip — short list of compliance / trust signals shown below the
 * CTAs. Pure motion + text, no images, so it stays tiny and pure.
 */
const TRUST = [
  "画布与工作流",
  "费用逐次确认",
  "云端素材限期保留",
  "支持本地保存",
];

export function HeroTrustStrip() {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      transition={{ delay: 1.4 }}
      className="mt-16 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground"
    >
      {TRUST.map((item, i) => (
        <span key={item} className="inline-flex items-center gap-1.5">
          {i === 0 && <Shield className="size-3 opacity-60" strokeWidth={1.5} />}
          {item}
          {i < TRUST.length - 1 && <span className="opacity-30">·</span>}
        </span>
      ))}
    </motion.div>
  );
}
