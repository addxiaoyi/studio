"use client";

import { useState, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  Plus,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { t, useLocale } from "@/lib/i18n";

import { useAuth } from "@/lib/auth-context";
import { useCredits } from "@/hooks/use-credits";
import {
  createEpayTopup,
  createEpayCustomTopup,
  fetchTopupPackages,
  getTopupOrder,
  isEpayEnabled,
} from "@/lib/credits-api";
import type { TopupPackage } from "@helstera/shared";

type EpayType = "alipay" | "wxpay";
type NoticeKind = "success" | "error" | "info";

function formatPrice(
  pkg: TopupPackage,
  region: "international" | "china",
): string {
  if (region === "china") {
    return `¥${(pkg.priceCnyFen / 100).toLocaleString()}`;
  }
  return `$${(pkg.priceUsdCents / 100).toLocaleString()}`;
}

export function BillingSection() {
  const copy = t(useLocale()).billing;
  const { session } = useAuth();
  const searchParams = useSearchParams();
  const { balance, totalToppedUp, totalSpent, refresh } = useCredits();
  const region: "international" | "china" = "china";
  const [packages, setPackages] = useState<TopupPackage[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(true);
  const [loadingPackageId, setLoadingPackageId] = useState<string | null>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<NoticeKind>("info");
  const [packageError, setPackageError] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState("100");
  const [payType, setPayType] = useState<EpayType>("alipay");

  const showNotice = useCallback((message: string | null, kind: NoticeKind = "info") => {
    setNotice(message);
    setNoticeKind(kind);
  }, []);

  // Load packages
  const loadPackages = useCallback(async () => {
    setLoadingPackages(true);
    setPackageError(null);
    try {
      const { packages } = await fetchTopupPackages();
      setPackages(packages);
    } catch (err) {
      console.error("[billing] Failed to load packages:", err);
      setPackageError("充值套餐暂时无法加载，可先使用自定义充值。请重试。");
    } finally {
      setLoadingPackages(false);
    }
  }, []);
  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  useEffect(() => {
    const outTradeNo = searchParams.get("topup");
    const token = session?.access_token;
    if (!outTradeNo || !token) return;

    let cancelled = false;
    const poll = async () => {
      for (let attempt = 0; attempt < 12 && !cancelled; attempt += 1) {
        try {
          const { order } = await getTopupOrder(token, outTradeNo);
          if (order.status === "paid") {
            await refresh();
            showNotice(copy.paid, "success");
            return;
          }
          if (["failed", "expired", "refunded"].includes(order.status)) {
            showNotice(copy.incomplete, "error");
            return;
          }
        } catch (error) {
          console.error("[billing] Failed to refresh top-up order:", error);
          showNotice(copy.unknown, "error");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [copy, refresh, searchParams, session?.access_token, showNotice]);

  const handleTopup = useCallback(
    async (pkg: TopupPackage) => {
      const token = session?.access_token;
      if (!token) {
        window.location.href = "/login?redirect=/settings?tab=billing";
        return;
      }

      setLoadingPackageId(pkg.id);
      showNotice(null);

      try {
        if (!isEpayEnabled()) {
          throw new Error("支付网关尚未配置，请联系管理员。");
        }
        const { checkoutUrl } = await createEpayTopup(token, pkg.id, payType);
        window.location.assign(checkoutUrl);
      } catch (err) {
        showNotice(err instanceof Error ? err.message : copy.createFailed, "error");
      } finally {
        setLoadingPackageId(null);
      }
    },
    [copy, payType, session?.access_token, showNotice],
  );
  const handleCustomTopup = useCallback(async () => {
    const token = session?.access_token;
    const amount = Math.round(Number(customAmount) * 100);
    if (!token) {
      window.location.href = "/login?redirect=/settings?tab=billing";
      return;
    }
    if (!Number.isInteger(amount) || amount < 1000 || amount > 5000000) {
      showNotice(copy.invalidAmount, "error");
      return;
    }
    setCustomLoading(true);
    showNotice(null);
    try {
      const { checkoutUrl } = await createEpayCustomTopup(token, amount, payType);
      window.location.assign(checkoutUrl);
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "创建订单失败，请重试。",
        "error",
      );
    } finally {
      setCustomLoading(false);
    }
  }, [copy, customAmount, payType, session?.access_token, showNotice]);

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h2 className="display-sm text-foreground">{copy.title}</h2>
        <p className="mt-3 body-relaxed max-w-lg">{copy.description}</p>
      </div>

      <div className="rounded-2xl glass-soft border border-border/40 p-5">
        <h3 className="font-medium text-foreground">{copy.custom}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{copy.customHint}</p>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="支付方式">
          {([['alipay', '支付宝'], ['wxpay', '微信支付']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setPayType(value)}
              aria-pressed={payType === value}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                payType === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex max-w-sm gap-2">
          <input
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            type="number"
            min="10"
            max="50000"
            step="1"
            className="h-10 flex-1 rounded-lg border border-border bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="充值金额（元）"
          />
          <button
            type="button"
            onClick={handleCustomTopup}
            disabled={customLoading}
            aria-busy={customLoading}
            className="rounded-lg bg-foreground px-4 text-sm text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
          >
            {customLoading ? "创建中…" : "充值"}
          </button>
        </div>
      </div>
      {packageError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <span>{packageError}</span>
          <button type="button" onClick={() => void loadPackages()} disabled={loadingPackages} className="rounded-md border border-amber-500/40 px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">重试加载套餐</button>
        </div>
      ) : null}
      {notice ? (
        <p role={noticeKind === "error" ? "alert" : "status"} aria-live={noticeKind === "error" ? "assertive" : "polite"} className={cn("rounded-xl border px-4 py-3 text-sm", noticeKind === "error" ? "border-destructive/30 bg-destructive/5 text-destructive" : noticeKind === "success" ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" : "border-border/50 bg-muted/30 text-muted-foreground")}>
          {notice}
        </p>
      ) : null}

      {/* Balance hero */}
      <div className="rounded-2xl glass border border-border/40 p-6 sm:p-7">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="eyebrow">当前余额</p>
            <p className="mt-3 text-5xl font-extralight tabular-nums tracking-tighter text-foreground">
              {balance.toLocaleString()}
            </p>
            <p className="mt-1 text-sm text-muted-foreground font-light">
              可用余额（元）
            </p>
          </div>
          <div className="rounded-2xl glass-soft border border-border/40 p-3">
            <Zap
              className="size-6 text-accent"
              strokeWidth={1.5}
              fill="currentColor"
            />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:max-w-md">
          <div className="rounded-xl glass-soft border border-border/30 px-4 py-3">
            <p className="eyebrow">累计充值</p>
            <p className="mt-2 text-2xl font-light tabular-nums tracking-tight text-foreground">
              {totalToppedUp.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl glass-soft border border-border/30 px-4 py-3">
            <p className="eyebrow">已消耗</p>
            <p className="mt-2 text-2xl font-light tabular-nums tracking-tight text-foreground">
              {totalSpent.toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* Fixed packages remain available as quick amount shortcuts. */}
      <div className="hidden">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="display-sm text-foreground">选择充值包</h3>
            <p className="mt-2 text-sm text-muted-foreground font-light">
              {region === "china"
                ? "中国大陆：易支付 (YeePay)，支持支付宝/微信扫码"
                : "国际支付渠道正在接入中，当前仅开放 CNY 易支付充值"}
            </p>
          </div>

          {/* Region toggle */}
          <div className="self-start inline-flex items-center gap-1 rounded-full glass-soft border border-border/40 p-1 text-xs">
            <button
              type="button"
              className={cn(
                "rounded-full px-3 py-1.5 transition-all duration-200",
                false
                  ? "bg-foreground text-background font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              🌐 USD
            </button>
            <button
              type="button"
              className={cn(
                "rounded-full px-3 py-1.5 transition-all duration-200",
                true
                  ? "bg-foreground text-background font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              🇨🇳 CNY
            </button>
          </div>
        </div>

        {notice && (
          <div className="mb-5 rounded-2xl glass-soft border border-amber-500/30 px-4 py-3 text-sm text-foreground/80 font-light">
            {notice}
          </div>
        )}

        {loadingPackages ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-[1.5rem] glass-soft border border-border/40 p-7 animate-pulse"
              >
                <div className="h-4 w-20 rounded glass-soft" />
                <div className="mt-4 h-10 w-32 rounded glass-soft" />
                <div className="mt-4 h-6 w-24 rounded glass-soft" />
                <div className="mt-6 h-10 w-full rounded-full glass-soft" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {packages.map((pkg) => (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                region={region}
                loading={loadingPackageId === pkg.id}
                onTopup={handleTopup}
                copy={copy}
              />
            ))}
          </div>
        )}
      </div>


    </div>
  );
}

function PackageCard({
  pkg,
  region,
  loading,
  onTopup,
  copy,
}: {
  pkg: TopupPackage;
  region: "international" | "china";
  loading: boolean;
  onTopup: (pkg: TopupPackage) => void;
  copy: ReturnType<typeof t>["billing"];
}) {
  const isHighlighted = pkg.highlighted;
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "relative flex flex-col rounded-[1.5rem] p-7 transition-all duration-300",
        isHighlighted
          ? "glass border border-foreground/15 shadow-card-hover"
          : "glass-soft border border-border/40 hover:glass",
      )}
    >
      {isHighlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-medium tracking-wide bg-foreground text-background">
            {copy.bestValue}
          </span>
        </div>
      )}

      <h3 className="text-lg font-medium text-foreground tracking-tight">
        {pkg.name}
      </h3>

      <div className="mt-4">
        <span className="text-4xl font-extralight tabular-nums tracking-tighter text-foreground">
          {formatPrice(pkg, region)}
        </span>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-light tabular-nums text-foreground tracking-tight">
          {pkg.credits.toLocaleString()}
        </span>
        <span className="text-sm text-muted-foreground font-light">
          {copy.credits}
        </span>
      </div>

      <p className="mt-2 text-xs text-muted-foreground/80 font-light">
        {copy.total} ¥{(pkg.priceCnyFen / 100).toLocaleString()} 余额 · {copy.permanent}
      </p>

      <button
        type="button"
        onClick={() => onTopup(pkg)}
        disabled={loading}
        className={cn(
          "mt-5 w-full inline-flex items-center justify-center gap-2 rounded-full h-9 px-4 text-sm font-medium transition-all duration-300",
          isHighlighted
            ? "bg-foreground text-background hover:scale-[1.02] active:scale-[0.99]"
            : "glass-soft border border-border/40 hover:glass",
        )}
      >
        {loading ? (
          <>
            <Loader2 className="size-3.5 animate-spin" strokeWidth={1.5} />
            {copy.processing}
          </>
        ) : (
          <>
            <Plus className="size-3.5" strokeWidth={1.5} />
            {copy.buy}
          </>
        )}
      </button>
    </motion.div>
  );
}
