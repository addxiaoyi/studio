"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ScrollReveal } from "./motion";
import { fadeUp } from "./motion";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  className?: string;
  align?: "center" | "left";
}

export function SectionHeader({
  title,
  subtitle,
  eyebrow,
  className,
  align = "center",
}: SectionHeaderProps) {
  const isCenter = align === "center";

  return (
    <ScrollReveal
      className={cn(
        "flex flex-col gap-6",
        isCenter && "items-center text-center",
        !isCenter && "items-start text-left",
        className
      )}
    >
      {eyebrow && (
        <motion.span variants={fadeUp} className="eyebrow">
          {eyebrow}
        </motion.span>
      )}

      <motion.h2
        variants={fadeUp}
        className={cn(
          "display-lg text-foreground",
          "max-w-3xl",
        )}
      >
        {title}
      </motion.h2>

      {subtitle && (
        <motion.p
          variants={fadeUp}
          transition={{ delay: 0.1 }}
          className={cn(
            "body-relaxed max-w-2xl",
          )}
        >
          {subtitle}
        </motion.p>
      )}
    </ScrollReveal>
  );
}
