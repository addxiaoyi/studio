"use client";

import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useScroll, useTransform } from "framer-motion";
import { fadeUp } from "@/components/landing/motion";

/**
 * ScrollIndicator — pulsing chevron that fades as user scrolls.
 * Extracted from hero section for reuse across the landing page.
 */
export function ScrollIndicator() {
  const { scrollY } = useScroll();
  const opacity = useTransform(scrollY, [0, 200], [1, 0]);

  return (
    <motion.div
      style={{ opacity }}
      className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
    >
      <motion.div
        animate={{ y: [0, 8, 0] }}
        transition={{ repeat: Infinity, duration: 2.4, ease: [0.37, 0, 0.63, 1] }}
      >
        <ChevronDown className="size-5 text-muted-foreground/40" strokeWidth={1.5} />
      </motion.div>
    </motion.div>
  );
}
