// @credits-system — Sidebar credit balance widget with popover and top-up CTA
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronRight, Zap, Plus } from "lucide-react";
import Link from "next/link";
import { useCredits } from "@/hooks/use-credits";

function AnimatedBalance({ value }: { value: number }) {
  const [displayed, setDisplayed] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (prev === value) return;

    const diff = value - prev;
    const steps = Math.min(Math.abs(diff), 20);
    const stepTime = Math.max(30, 400 / steps);
    let step = 0;

    const timer = setInterval(() => {
      step++;
      const progress = step / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(prev + diff * eased));
      if (step >= steps) {
        clearInterval(timer);
        setDisplayed(value);
      }
    }, stepTime);

    return () => clearInterval(timer);
  }, [value]);

  return <span>{displayed.toLocaleString()}</span>;
}

export function CreditBalance() {
  const { balance, totalToppedUp, totalSpent, loading } = useCredits();

  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
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
      bottom: window.innerHeight - rect.bottom - 4,
      left: rect.right + 12,
      zIndex: 9999,
    });
  }, [open]);

  if (loading) {
    return (
      <div className="flex h-9 w-9 items-center justify-center">
        <div className="h-4 w-4 animate-pulse rounded-full bg-foreground/30" />
      </div>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${balance} credits`}
        className="relative flex h-9 w-9 flex-col items-center justify-center gap-0.5 rounded-full glass-soft border border-border/40 transition-all duration-300 hover:glass"
      >
        <Sparkles className="h-4 w-4 text-foreground/60" strokeWidth={1.5} />
        <span className="text-[9px] font-medium leading-none text-foreground/60 tabular-nums">
          {balance > 9999 ? `${Math.floor(balance / 1000)}k` : balance}
        </span>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            <div ref={popoverRef} style={popoverStyle}>
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="w-64 rounded-2xl glass-strong border border-border/40 p-5 text-foreground shadow-card-hover"
              >
                <div className="mb-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-accent" strokeWidth={1.5} />
                    <span className="text-3xl font-light tabular-nums text-foreground tracking-tight">
                      <AnimatedBalance value={balance} />
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground font-light">
                    可用积分
                  </p>
                </div>

                <div className="mb-4 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between rounded-xl glass-soft border border-border/30 px-3 py-2">
                    <span className="text-muted-foreground font-light">累计充值</span>
                    <span className="font-light tabular-nums text-foreground/80">
                      {totalToppedUp.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl glass-soft border border-border/30 px-3 py-2">
                    <span className="text-muted-foreground font-light">已使用</span>
                    <span className="font-light tabular-nums text-foreground/80">
                      {totalSpent.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="mb-3 h-px bg-border/30" />

                <Link
                  href="/settings?tab=billing"
                  onClick={() => setOpen(false)}
                  className="mb-2 flex w-full items-center justify-center gap-2 rounded-full bg-foreground text-background h-9 px-3 text-sm font-medium transition-all duration-300 hover:scale-[1.02] active:scale-[0.99]"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                  充值积分
                </Link>

                <Link
                  href="/settings?tab=billing"
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center justify-between rounded-full px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
                >
                  <span className="flex items-center gap-2 font-light">
                    <Zap className="h-3.5 w-3.5" strokeWidth={1.5} />
                    积分明细
                  </span>
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
