"use client";
import "./ui/surfaces.css";

import { useNoticeTimer } from "@/hooks/use-notice-timer";
import { useSurfaceEntry } from "@/hooks/use-surface-entry";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastVariant = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const TOAST_DURATION = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const add = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev.filter(notice=>notice.message!==message||notice.variant!==variant), { id, message, variant }].slice(-4));
    },
    [remove],
  );

  const ctx = useMemo<ToastContextValue>(
    () => ({
      toast: add,
      success: (msg) => add(msg, "success"),
      error: (msg) => add(msg, "error"),
    }),
    [add],
  );

  return (
    <ToastContext.Provider value={ctx}>
      {children}

      <div className="app-notice-viewport" aria-label="通知">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={() => remove(t.id)} />
          ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

const variantStyles: Record<ToastVariant, { dot: string; icon: ReactNode }> = {
  success: {
    dot: "bg-success",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-success">
        <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
      </svg>
    ),
  },
  error: {
    dot: "bg-destructive",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-destructive">
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM7.25 4.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5ZM8 11.5A.75.75 0 1 1 8 10a.75.75 0 0 1 0 1.5Z" />
      </svg>
    ),
  },
  info: {
    dot: "bg-info",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-info">
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM7.25 4.5a.75.75 0 0 1 1.5 0v.5a.75.75 0 0 1-1.5 0v-.5ZM6.75 7.75A.75.75 0 0 1 7.5 7h.25a.75.75 0 0 1 .75.75v3h.25a.75.75 0 0 1 0 1.5h-1.5a.75.75 0 0 1 0-1.5H7.5V8.5h-.25a.75.75 0 0 1-.75-.75Z" />
      </svg>
    ),
  },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { icon } = variantStyles[toast.variant];
  const role = toast.variant === "error" ? "alert" : "status";
  const timer=useNoticeTimer(toast.variant==="error"?0:TOAST_DURATION,onDismiss);
  const ref=useSurfaceEntry<HTMLDivElement>();

  return (
    <div ref={ref} {...timer}
      role={role}
      className="app-notice"
    >
      {icon}
      <span className="min-w-0 flex-1 break-words">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="关闭通知"
        className="ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
