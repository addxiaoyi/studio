"use client";

import { cn } from "@/lib/utils";

import { StrokeText } from "./stroke-text";

type BrandSize = "sm" | "md" | "lg" | "hero";

const sizeStyles: Record<BrandSize, { word: string; stroke: number; pixels: number }> = {
  sm: { word: "text-sm", stroke: 0.8, pixels: 18 },
  md: { word: "text-base", stroke: 0.9, pixels: 22 },
  lg: { word: "text-2xl", stroke: 1.1, pixels: 32 },
  hero: { word: "text-4xl sm:text-5xl", stroke: 1.4, pixels: 52 },
};

export function HelsteraBrandMark({
  size = "md",
  animated = false,
  className,
}: {
  size?: BrandSize;
  animated?: boolean;
  className?: string;
}) {
  const styles = sizeStyles[size];

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)} role="img" aria-label="Helstera">
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
        <span className={cn("helstera-wordmark", styles.word, "font-medium tracking-tight")}>Helstera</span>
      )}
    </span>
  );
}
