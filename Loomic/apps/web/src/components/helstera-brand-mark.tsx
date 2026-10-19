"use client";

import { HelsteraLogo } from "@/components/icons/helstera-logo";
import { cn } from "@/lib/utils";

import { StrokeText } from "./stroke-text";

type BrandSize = "sm" | "md" | "lg" | "hero";

const sizeStyles: Record<BrandSize, { word: string; icon: string; stroke: number; pixels: number }> = {
  sm: { word: "text-sm", icon: "size-5", stroke: 0.8, pixels: 18 },
  md: { word: "text-base", icon: "size-6", stroke: 0.9, pixels: 22 },
  lg: { word: "text-2xl", icon: "size-10", stroke: 1.1, pixels: 32 },
  hero: { word: "text-4xl sm:text-5xl", icon: "size-14", stroke: 1.4, pixels: 52 },
};

export function HelsteraBrandMark({
  size = "md",
  animated = false,
  showIcon = true,
  className,
}: {
  size?: BrandSize;
  animated?: boolean;
  showIcon?: boolean;
  className?: string;
}) {
  const styles = sizeStyles[size];

  if (!showIcon) {
    return <HelsteraLogo className={cn(styles.icon, "text-current", className)} />;
  }

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)} role="img" aria-label="Helstera">
      <HelsteraLogo alt="" className={cn(styles.icon, "shrink-0 text-current")} />
      <span className="sr-only">Helstera</span>
      {animated ? (
        <StrokeText
          text="Helstera"
          className={styles.word}
          strokeColor="currentColor"
          fillColor="currentColor"
          strokeWidth={styles.stroke}
          fontSize={styles.pixels}
          trigger="mount"
          decorative
        />
      ) : (
        <span className={cn(styles.word, "font-medium tracking-tight")}>Helstera</span>
      )}
    </span>
  );
}
