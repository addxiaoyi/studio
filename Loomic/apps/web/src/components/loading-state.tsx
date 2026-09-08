"use client";

import { cn } from "@/lib/utils";

interface LoadingStateProps {
  /** Number of skeleton lines to render. */
  lines?: number;
  /** Use skeleton card instead of text lines. */
  variant?: "text" | "card" | "circle";
  className?: string;
}

/**
 * Unified loading state — composes the design system Skeleton.
 * Replaces ad-hoc loading placeholders across the app.
 */
export function LoadingState({
  lines = 3,
  variant = "text",
  className,
}: LoadingStateProps) {
  if (variant === "card") {
    return (
      <div
        className={cn(
          "rounded-2xl glass-soft border border-border/40 p-4",
          className,
        )}
        aria-label="加载中"
        role="status"
      >
        <div className="h-32 w-full rounded-xl bg-foreground/[0.04] relative overflow-hidden">
          <div
            className="absolute inset-0 -translate-x-full"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, oklch(0.85 0.005 260 / 0.12) 50%, transparent 100%)",
              animation: "skeleton-shimmer 1.8s ease-in-out infinite",
            }}
          />
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {Array.from({ length: lines }, (_, i) => (
            <div
              key={i}
              className="h-3 bg-foreground/[0.04] rounded relative overflow-hidden"
              style={{ width: i === lines - 1 ? "60%" : "100%" }}
            >
              <div
                className="absolute inset-0 -translate-x-full"
                style={{
                  background:
                    "linear-gradient(90deg, transparent 0%, oklch(0.85 0.005 260 / 0.12) 50%, transparent 100%)",
                  animation: "skeleton-shimmer 1.8s ease-in-out infinite",
                  animationDelay: `${i * 100}ms`,
                }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "circle") {
    return (
      <div
        className={cn(
          "flex items-center justify-center",
          className,
        )}
        role="status"
        aria-label="加载中"
      >
        <div className="relative">
          <div className="size-12 rounded-full border-2 border-border/40" />
          <div
            className="absolute inset-0 size-12 rounded-full border-2 border-transparent border-t-foreground"
            style={{ animation: "spin 0.8s linear infinite" }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      role="status"
      aria-label="加载中"
    >
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="h-3 bg-foreground/[0.04] rounded relative overflow-hidden"
          style={{ width: i === lines - 1 && lines > 1 ? "60%" : "100%" }}
        >
          <div
            className="absolute inset-0 -translate-x-full"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, oklch(0.85 0.005 260 / 0.12) 50%, transparent 100%)",
              animation: "skeleton-shimmer 1.8s ease-in-out infinite",
              animationDelay: `${i * 100}ms`,
            }}
          />
        </div>
      ))}
    </div>
  );
}
