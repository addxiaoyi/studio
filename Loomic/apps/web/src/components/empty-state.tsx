"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// EmptyState — single source of truth for all empty surfaces
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  /**
   * Lucide icon component. Also accepts any React component
   * (so tests can pass plain SVG placeholders without a Lucide dep).
   */
  icon: LucideIcon | React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /** Glass level for the icon container. Default: "soft" */
  variant?: "soft" | "default" | "strong";
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  variant = "soft",
}: EmptyStateProps) {
  const iconContainerClass = {
    soft: "glass-soft border border-border/40",
    default: "glass border border-border/40",
    strong: "glass-strong border border-border/40",
  }[variant];

  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center",
        className,
      )}
    >
      <div
        className={cn(
          "rounded-2xl p-5",
          iconContainerClass,
        )}
      >
        <Icon
          className="size-7 text-foreground/70"
          strokeWidth={1.25}
          aria-hidden="true"
        />
      </div>

      <div className="max-w-sm">
        <h3 className="text-base font-medium text-foreground tracking-tight">
          {title}
        </h3>
        {description && (
          <p className="mt-2 text-sm text-muted-foreground/80 font-light leading-relaxed">
            {description}
          </p>
        )}
      </div>

      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyStateAction — standardized CTA inside EmptyState
// ---------------------------------------------------------------------------

interface EmptyStateActionProps {
  primary?: { label: string; onClick?: () => void; type?: "button" | "submit" };
  secondary?: { label: string; onClick?: () => void };
}

export function EmptyStateAction({ primary, secondary }: EmptyStateActionProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {primary && (
        <button
          type={primary.type ?? "button"}
          onClick={primary.onClick}
          className="inline-flex items-center px-5 py-2.5 rounded-full text-sm font-medium bg-foreground text-background transition-all duration-300 hover:scale-[1.02] active:scale-[0.99]"
        >
          {primary.label}
        </button>
      )}
      {secondary && (
        <button
          type="button"
          onClick={secondary.onClick}
          className="inline-flex items-center px-5 py-2.5 rounded-full text-sm font-medium glass-soft hover:glass border border-border/40 text-foreground transition-all duration-300"
        >
          {secondary.label}
        </button>
      )}
    </div>
  );
}
