"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

import { useDesktopCopy } from "@/lib/desktop-copy";

export type DesktopToastTone = "success" | "error" | "info";

export type DesktopToastInput = {
  tone?: DesktopToastTone;
  message: string;
  /** Stable key: repeats within the de-duplication window are dropped. */
  key?: string;
  durationMs?: number;
};

type DesktopToast = DesktopToastInput & { id: number; tone: DesktopToastTone };

type DesktopToastApi = {
  push: (input: DesktopToastInput | string) => void;
  dismiss: (id: number) => void;
};

const DesktopToastContext = createContext<DesktopToastApi | null>(null);

const DEFAULT_DURATION_MS = 4000;
const DEDUPE_WINDOW_MS = 5000;
/** At 41.5px per toast, more than four would cover most of a 480px-tall window. */
const MAX_VISIBLE_TOASTS = 4;

export function DesktopToastProvider({ children }: { children: ReactNode }) {
  const { copy } = useDesktopCopy();
  const [toasts, setToasts] = useState<DesktopToast[]>([]);
  const nextId = useRef(1);
  const recentKeys = useRef(new Map<string, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((input: DesktopToastInput | string) => {
    const toast: DesktopToastInput = typeof input === "string" ? { message: input } : input;
    const tone = toast.tone ?? "info";
    // Errors are never de-duplicated: pressing a failing action twice must look like
    // two failures, not like a dead button. Only informational chatter is collapsed.
    if (tone !== "error") {
      const key = toast.key ?? `${tone}:${toast.message}`;
      const now = Date.now();
      const lastAt = recentKeys.current.get(key) ?? 0;
      if (now - lastAt < DEDUPE_WINDOW_MS) return;
      recentKeys.current.set(key, now);
    }

    const id = nextId.current++;
    setToasts((current) => [...current, { ...toast, tone, id }].slice(-MAX_VISIBLE_TOASTS));
    const duration = toast.durationMs ?? DEFAULT_DURATION_MS;
    if (duration > 0) setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  const api = useMemo<DesktopToastApi>(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <DesktopToastContext.Provider value={api}>
      {children}
      <div className="desktop-toast-viewport" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`desktop-toast desktop-toast--${toast.tone}`}>
            <span className="desktop-toast__icon" aria-hidden="true">
              {toast.tone === "success" ? <CheckCircle2 /> : toast.tone === "error" ? <TriangleAlert /> : <Info />}
            </span>
            <span className="desktop-toast__message">{toast.message}</span>
            <button
              type="button"
              className="desktop-toast__dismiss"
              aria-label={copy.chrome.toast.close}
              onClick={() => dismiss(toast.id)}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </DesktopToastContext.Provider>
  );
}

/** Returns the toast API, or a no-op when used outside the provider so a missing
 *  provider degrades to "no toast" instead of crashing the page. */
export function useDesktopToast(): DesktopToastApi {
  const api = useContext(DesktopToastContext);
  return api ?? NOOP_API;
}

const NOOP_API: DesktopToastApi = { push: () => {}, dismiss: () => {} };
