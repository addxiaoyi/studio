"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download } from "lucide-react";

/**
 * Captures `beforeinstallprompt` and surfaces a soft glass prompt
 * after 3s of dwell. Dismissible; remembers dismissal for 14 days.
 */
const STORAGE_KEY = "helstera-pwa-install-dismissed-at";
const MIN_DWELL_MS = 3000;
const SUPPRESS_DAYS = 14;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PWAInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Already dismissed recently?
    const lastDismissed = Number(window.localStorage.getItem(STORAGE_KEY));
    if (lastDismissed && Date.now() - lastDismissed < SUPPRESS_DAYS * 86_400_000) {
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Show after a small dwell so we don't interrupt the first impression.
    const timer = window.setTimeout(() => {
      setVisible((v) => v || Boolean(deferred));
    }, MIN_DWELL_MS);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.clearTimeout(timer);
    };
  }, [deferred]);

  // Once deferred is set AND timer has elapsed, render the prompt.
  useEffect(() => {
    if (deferred) {
      const timer = window.setTimeout(() => setVisible(true), MIN_DWELL_MS);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [deferred]);

  const dismiss = () => {
    setVisible(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
    }
  };

  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") {
        dismiss();
      } else {
        dismiss();
      }
    } catch {
      dismiss();
    } finally {
      setDeferred(null);
    }
  };

  return (
    <AnimatePresence>
      {visible && deferred && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2"
          role="region"
          aria-label="安装 Helstera 应用"
        >
          <div className="glass-strong rounded-2xl border border-border/40 shadow-card-hover p-4 max-w-md flex items-center gap-3">
            <div className="size-9 rounded-xl glass-soft border border-border/40 flex items-center justify-center shrink-0">
              <Download className="size-4 text-foreground/70" strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">安装 Helstera</p>
              <p className="text-xs text-muted-foreground font-light leading-snug">
                添加到桌面，离线也能使用
              </p>
            </div>
            <button
              type="button"
              onClick={install}
              className="rounded-full bg-foreground text-background px-4 h-8 text-xs font-medium transition-all duration-300 hover:scale-[1.02] active:scale-[0.99]"
            >
              安装
            </button>
            <button
              type="button"
              onClick={dismiss}
              aria-label="关闭"
              className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
            >
              <X className="size-3.5" strokeWidth={1.5} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
