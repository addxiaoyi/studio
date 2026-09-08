"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, X, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createYeePayTopup,
  getYeePayOrderStatus,
  type YeePayTopupResult,
} from "@/lib/yeepay-api";

interface YeePayCheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Top-up package id (e.g. "starter-pack", "pro-pack") */
  packageId: string;
  /** Display label for the package, shown in dialog title */
  packageLabel: string;
  /** Amount in CNY fen (¥x.xx), shown in instructions */
  amountCnyFen: number;
  accessToken: string;
  onSuccess: () => void;
}

type Status = "creating" | "waiting" | "paid" | "expired" | "failed";

export function YeePayCheckoutDialog({
  open,
  onOpenChange,
  packageId,
  packageLabel,
  amountCnyFen,
  accessToken,
  onSuccess,
}: YeePayCheckoutDialogProps) {
  const [status, setStatus] = useState<Status>("creating");
  const [checkout, setCheckout] = useState<YeePayTopupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [retryKey, setRetryKey] = useState(0);

  const amountCny = `¥${(amountCnyFen / 100).toFixed(2)}`;

  // Create order on open (or retry)
  useEffect(() => {
    if (!open) return;
    setStatus("creating");
    setError(null);
    setCheckout(null);

    createYeePayTopup(accessToken, packageId)
      .then((result) => {
        setCheckout(result);
        setStatus("waiting");
        setSecondsLeft(
          Math.max(0, Math.floor((result.expiredAt - Date.now()) / 1000)),
        );
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "创建订单失败");
        setStatus("failed");
      });
  }, [open, packageId, accessToken, retryKey]);

  // Countdown timer
  useEffect(() => {
    if (status !== "waiting") return;
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timer);
          setStatus("expired");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [status]);

  // Poll order status
  useEffect(() => {
    if (status !== "waiting" || !checkout) return;
    const poll = setInterval(() => {
      getYeePayOrderStatus(accessToken, checkout.outTradeNo)
        .then((result) => {
          if (result.status === "paid") {
            setStatus("paid");
            clearInterval(poll);
            setTimeout(() => {
              onSuccess();
              onOpenChange(false);
            }, 1500);
          }
        })
        .catch(() => {
          // Silently retry — polling failures are transient
        });
    }, 2500);
    return () => clearInterval(poll);
  }, [status, checkout, accessToken, onSuccess, onOpenChange]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => onOpenChange(false)}
            className="fixed inset-0 z-[2000] bg-black/30 backdrop-blur-sm"
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="fixed left-1/2 top-1/2 z-[2001] w-[440px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl glass-strong border border-border/40 p-6 shadow-card-hover"
          >
            {/* Close button */}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="关闭"
              className="absolute right-4 top-4 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground transition-all focus-visible:ring-2 focus-visible:ring-foreground/20"
            >
              <X className="size-4" strokeWidth={1.5} />
            </button>

            {/* Header */}
            <div className="mb-5">
              <h2 className="text-lg font-medium text-foreground tracking-tight">
                易支付扫码支付
              </h2>
              <p className="mt-1 text-sm text-muted-foreground font-light">
                {packageLabel} · {amountCny}
              </p>
            </div>

            {/* Body */}
            {status === "creating" && (
              <div className="flex flex-col items-center gap-3 py-12">
                <Loader2
                  className="size-6 animate-spin-slow text-foreground/60"
                  strokeWidth={1.5}
                />
                <p className="text-sm text-muted-foreground font-light">
                  正在创建订单...
                </p>
              </div>
            )}

            {status === "waiting" && checkout && (
              <div className="flex flex-col items-center gap-4">
                {/* QR code */}
                <div className="relative rounded-2xl bg-white p-4 shadow-card">
                  <img
                    src={checkout.qrCodeImage}
                    alt="易支付扫码二维码"
                    className="size-56"
                    width={224}
                    height={224}
                  />
                </div>

                {/* Countdown */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground font-light">
                  <Clock className="size-3.5" strokeWidth={1.5} />
                  <span className="tabular-nums">
                    {minutes.toString().padStart(2, "0")}:
                    {seconds.toString().padStart(2, "0")}
                  </span>
                  <span>后过期</span>
                </div>

                {/* Instructions */}
                <div className="w-full rounded-2xl glass-soft border border-border/30 p-4 space-y-1.5 text-xs text-muted-foreground font-light">
                  <p className="font-medium text-foreground">支付步骤：</p>
                  <p>
                    1. 打开手机{" "}
                    <span className="font-medium text-foreground">
                      支付宝 / 微信
                    </span>
                  </p>
                  <p>
                    2. 点击{" "}
                    <span className="font-medium text-foreground">扫一扫</span>
                    ，扫描上方二维码
                  </p>
                  <p>
                    3. 在支付页面确认金额{" "}
                    <span className="font-medium text-foreground">
                      {amountCny}
                    </span>{" "}
                    后完成付款
                  </p>
                  <p>4. 支付完成后页面将自动跳转</p>
                </div>
              </div>
            )}

            {status === "paid" && (
              <div className="flex flex-col items-center gap-3 py-12">
                <CheckCircle2
                  className="size-12 text-accent"
                  strokeWidth={1.5}
                />
                <p className="text-base font-medium text-foreground">
                  支付成功
                </p>
                <p className="text-sm text-muted-foreground font-light">
                  积分已到账，正在跳转...
                </p>
              </div>
            )}

            {status === "expired" && (
              <div className="flex flex-col items-center gap-3 py-10">
                <Clock
                  className="size-10 text-muted-foreground/40"
                  strokeWidth={1.5}
                />
                <p className="text-base font-medium text-foreground">
                  订单已过期
                </p>
                <p className="text-sm text-muted-foreground text-center max-w-xs font-light leading-relaxed">
                  请重新发起支付。
                </p>
                <Button
                  onClick={() => setRetryKey((k) => k + 1)}
                  className="mt-2 rounded-full"
                  variant="outline"
                >
                  <RefreshCw className="size-3.5 mr-1" strokeWidth={1.5} />
                  重新支付
                </Button>
              </div>
            )}

            {status === "failed" && (
              <div className="flex flex-col items-center gap-3 py-10">
                <p className="text-base font-medium text-foreground">
                  创建订单失败
                </p>
                <p className="text-sm text-destructive text-center max-w-xs font-light leading-relaxed">
                  {error}
                </p>
                <Button
                  onClick={() => setRetryKey((k) => k + 1)}
                  className="mt-2 rounded-full"
                  variant="outline"
                >
                  <RefreshCw className="size-3.5 mr-1" strokeWidth={1.5} />
                  重试
                </Button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
