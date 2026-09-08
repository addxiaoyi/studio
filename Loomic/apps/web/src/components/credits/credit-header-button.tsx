"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";

import { useAuth } from "@/lib/auth-context";
import { useCredits } from "@/hooks/use-credits";

export function CreditHeaderButton() {
  const { user } = useAuth();
  const { balance, totalToppedUp, loading } = useCredits();

  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPopoverStyle({
      position: "fixed",
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right,
      zIndex: 9999,
    });
  }, [open]);

  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ??
    user?.email?.split("@")[0] ??
    "User";

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-8 w-20 animate-pulse rounded-full glass-soft" />
      </div>
    );
  }

  return (
    <>
      <div ref={btnRef} className="flex items-center gap-1.5">
        <Link
          href="/settings?tab=billing"
          className="flex h-8 items-center gap-1.5 rounded-full glass-soft border border-border/40 px-3 text-xs font-medium text-foreground transition-all duration-300 hover:glass"
        >
          <Plus className="h-3 w-3 text-accent" strokeWidth={1.5} />
          <span>充值</span>
        </Link>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 items-center gap-1.5 rounded-full glass-soft border border-border/40 px-3 text-xs font-medium tabular-nums text-foreground transition-all duration-300 hover:glass"
        >
          <Zap className="h-3 w-3 text-accent fill-accent" strokeWidth={1.5} />
          <span>{balance.toLocaleString()}</span>
        </button>

        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={displayName}
            className="h-8 w-8 rounded-full border border-border/40 object-cover"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full glass-soft border border-border/40 text-xs font-medium text-foreground/70">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            <div ref={popoverRef} style={popoverStyle}>
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="w-72 rounded-2xl glass-strong border border-border/40 p-5 text-foreground shadow-card-hover"
              >
                <div className="mb-4 flex items-center gap-2">
                  <Zap className="h-5 w-5 text-accent" strokeWidth={1.5} />
                  <span className="text-3xl font-light tabular-nums text-foreground tracking-tight">
                    {balance.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground font-light">积分</span>
                </div>

                <div className="mb-4 flex items-center justify-between rounded-xl glass-soft border border-border/30 px-3 py-2">
                  <span className="text-xs text-muted-foreground font-light">累计充值</span>
                  <span className="font-light tabular-nums text-foreground/80 text-sm">
                    {totalToppedUp.toLocaleString()}
                  </span>
                </div>

                <div className="mb-3 h-px bg-border/30" />

                <Link
                  href="/settings?tab=billing"
                  onClick={() => setOpen(false)}
                  className="mb-2 flex w-full items-center justify-center gap-2 rounded-full bg-foreground text-background h-9 px-4 text-sm font-medium transition-all duration-300 hover:scale-[1.02] active:scale-[0.99]"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                  充值积分
                </Link>

                <Link
                  href="/settings?tab=usage"
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center justify-between rounded-full px-3 py-2 text-sm text-muted-foreground transition-all duration-300 hover:bg-foreground/[0.04] hover:text-foreground"
                >
                  <span className="font-light">使用详情</span>
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                </Link>
              </motion.div>
            </div>
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
