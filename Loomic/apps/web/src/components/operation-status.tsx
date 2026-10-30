"use client";

import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  Save,
  Sparkles,
} from "lucide-react";
import type { ComponentType } from "react";

export type OperationStatusKind =
  | "idle"
  | "loading"
  | "saving"
  | "saved"
  | "running"
  | "success"
  | "error-retryable"
  | "error-blocked";

export interface OperationStatusProps {
  status: OperationStatusKind;
  label: string;
  detail?: string;
  progress?: number;
  actionLabel?: string;
  onAction?: () => void;
  busy?: boolean;
  className?: string;
}

const statusCopy: Record<Exclude<OperationStatusKind, "idle">, string> = {
  loading: "加载中",
  saving: "保存中",
  saved: "已保存",
  running: "处理中",
  success: "已完成",
  "error-retryable": "处理失败",
  "error-blocked": "无法继续",
};

const statusIcons: Record<Exclude<OperationStatusKind, "idle">, ComponentType<{ className?: string }>> = {
  loading: Loader2,
  saving: Save,
  saved: CheckCircle2,
  running: Sparkles,
  success: CheckCircle2,
  "error-retryable": CircleAlert,
  "error-blocked": CircleAlert,
};

export function OperationStatus({
  status,
  label,
  detail,
  progress,
  actionLabel,
  onAction,
  busy = false,
  className,
}: OperationStatusProps) {
  if (status === "idle") return null;

  const Icon = statusIcons[status];
  const isError = status === "error-retryable" || status === "error-blocked";
  const boundedProgress = progress === undefined ? undefined : Math.max(0, Math.min(100, progress));

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        isError ? "border-destructive/30 bg-destructive/5" : "border-border/60 bg-muted/30",
        className,
      )}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", status === "loading" || status === "saving" || status === "running" ? "animate-spin" : "")} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{label} · {statusCopy[status]}</p>
        {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
        {boundedProgress !== undefined ? (
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10"
            role="progressbar"
            tabIndex={0}
            aria-label={`${label}进度`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={boundedProgress}
          >
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${boundedProgress}%` }} />
          </div>
        ) : null}
      </div>
      {actionLabel && onAction ? (
        <button
          type="button"
          className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-foreground/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onAction}
          disabled={busy}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
