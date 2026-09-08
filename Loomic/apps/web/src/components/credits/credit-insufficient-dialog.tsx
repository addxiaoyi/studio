// @credits-system — Insufficient credits dialog: route user to top-up
"use client";

import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface CreditInsufficientDialogProps {
  open: boolean;
  onClose: () => void;
  currentBalance: number;
  requiredAmount: number;
}

export function CreditInsufficientDialog({
  open,
  onClose,
  currentBalance,
  requiredAmount,
}: CreditInsufficientDialogProps) {
  const shortage = Math.max(0, requiredAmount - currentBalance);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[10000] bg-black/30 backdrop-blur-sm"
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            className={cn(
              "fixed left-1/2 top-1/2 z-[10001] w-[420px] max-w-[92vw]",
              "-translate-x-1/2 -translate-y-1/2",
              "rounded-2xl glass-strong border border-border/40 p-6 shadow-card-hover",
            )}
          >
            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="absolute right-4 top-4 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground transition-all focus-visible:ring-2 focus-visible:ring-foreground/20"
            >
              <X className="size-4" strokeWidth={1.5} />
            </button>

            {/* Header */}
            <div className="mb-5 flex flex-col items-center text-center">
              <div className="mb-4 inline-flex rounded-2xl glass-soft border border-amber-500/30 p-3">
                <AlertTriangle
                  className="size-6 text-amber-600 dark:text-amber-400"
                  strokeWidth={1.5}
                />
              </div>
              <h2 className="text-lg font-medium text-foreground tracking-tight">
                积分不足
              </h2>
              <p className="mt-2 text-sm text-muted-foreground font-light leading-relaxed">
                本次生成需要{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {requiredAmount.toLocaleString()}
                </span>{" "}
                积分
                {shortage > 0 && (
                  <>
                    ，还差{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {shortage.toLocaleString()}
                    </span>{" "}
                    积分
                  </>
                )}
                。
              </p>
            </div>

            {/* Quick stats */}
            <div className="mb-5 rounded-2xl glass-soft border border-border/30 px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground font-light">当前余额</span>
                <span className="font-medium tabular-nums text-foreground">
                  {currentBalance.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground font-light">本次需要</span>
                <span className="font-medium tabular-nums text-foreground">
                  {requiredAmount.toLocaleString()}
                </span>
              </div>
            </div>

            {/* CTA — go to top-up */}
            <Link
              href="/settings?tab=billing"
              onClick={onClose}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground text-background h-10 px-5 text-sm font-medium transition-all duration-300 hover:scale-[1.01] active:scale-[0.99]"
            >
              <Plus className="size-3.5" strokeWidth={1.5} />
              立即充值积分
            </Link>

            <p className="mt-3 text-center text-xs text-muted-foreground/80 font-light">
              支持自定义金额、YeePay / Stripe / 支付宝
            </p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
