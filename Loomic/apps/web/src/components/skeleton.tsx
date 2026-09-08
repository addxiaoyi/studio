"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Skeleton — single primitive. All loading placeholders compose from this.
// ---------------------------------------------------------------------------

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Border-radius class. Default: rounded-md. */
  rounded?: "none" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "full";
}

export function Skeleton({ className, rounded = "md", ...props }: SkeletonProps) {
  const radiusClass = {
    none: "rounded-none",
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
    xl: "rounded-xl",
    "2xl": "rounded-2xl",
    "3xl": "rounded-3xl",
    full: "rounded-full",
  }[rounded];

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-foreground/[0.04]",
        radiusClass,
        className,
      )}
      aria-hidden="true"
      {...props}
    >
      {/* Shimmer sweep */}
      <div
        className="absolute inset-0 -translate-x-full"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, oklch(0.85 0.005 260 / 0.12) 50%, transparent 100%)",
          animation: "skeleton-shimmer 1.8s ease-in-out infinite",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkeletonText — line-of-text placeholder
// ---------------------------------------------------------------------------

interface SkeletonTextProps {
  lines?: number;
  lastLineWidth?: string;
  className?: string;
}

export function SkeletonText({
  lines = 1,
  lastLineWidth = "60%",
  className,
}: SkeletonTextProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => {
        const isLast = i === lines - 1;
        return (
          <Skeleton
            key={i}
            className="h-3.5"
            style={{
              width: isLast && lines > 1 ? lastLineWidth : "100%",
            }}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkeletonCard — glass card placeholder
// ---------------------------------------------------------------------------

interface SkeletonCardProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  showImage?: boolean;
}

export function SkeletonCard({ className, showImage = false, ...props }: SkeletonCardProps) {
  return (
    <div
      role="status"
      className={cn(
        "rounded-2xl glass-soft border border-border/40 p-4",
        className,
      )}
      {...props}
    >
      {showImage && <Skeleton className="w-full aspect-[4/3] mb-4" rounded="xl" />}
      <SkeletonText lines={2} lastLineWidth="50%" />
    </div>
  );
}
