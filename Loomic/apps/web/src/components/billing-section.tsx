"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, Plus, Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

import { useAuth } from "@/lib/auth-context";
import { useCredits } from "@/hooks/use-credits";
import { createEpayTopup, fetchTopupPackages, isEpayEnabled } from "@/lib/credits-api";
import { YeePayCheckoutDialog } from "@/components/yeepay-checkout-dialog";
import { CreditUsageHistory } from "@/components/credits/credit-usage-history";
import type { TopupPackage } from "@helstera/shared";

function detectRegion(): "international" | "china" {
  if (typeof window === "undefined") return "international";
  const lang = window.navigator?.language ?? "";
  if (lang.toLowerCase().startsWith("zh")) return "china";
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz.toLowerCase().includes("shanghai") || tz === "Asia/Chongqing") {
      return "china";
    }
  } catch {
    // ignore
  }
  return "international";
}

function formatPrice(pkg: TopupPackage, region: "international" | "china"): string {
  if (region === "china") {
    return `¥${(pkg.priceCnyFen / 100).toLocaleString()}`;
  }
  return `$${(pkg.priceUsdCents / 100).toLocaleString()}`;
}

export function BillingSection() {
  const { session } = useAuth();
  const { balance, totalToppedUp, totalSpent, refresh } = useCredits();
  const [region, setRegion] = useState<"international" | "china">("international");
  const [packages, setPackages] = useState<TopupPackage[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(true);
  const [activePackage, setActivePackage] = useState<TopupPackage | null>(null);
  const [yeepayOpen, setYeepayOpen] = useState(false);
  const [loadingPackageId, setLoadingPackageId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Detect region and load packages
  useEffect(() => {
    setRegion(detectRegion());
  }, []);

  // Load packages
  const loadPackages = useCallback(async () => {
    try {
      const { packages } = await fetchTopupPackages();
      setPackages(packages);
    } catch (err) {
      console.error("[billing] Failed to load packages:", err);
    } finally {
      setLoadingPackages(false);
    }
  }, []);
  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  const handleTopup = useCallback(
    async (pkg: TopupPackage) => {
      const token = session?.access_token;
      if (!token) {
        window.location.href = "/login?redirect=/settings?tab=billing";
        return;
      }

      setLoadingPackageId(pkg.id);
      setActivePackage(pkg);
      setNotice(null);

      try {
        if (region === "china") {
          if (isEpayEnabled()) {
            const { checkoutUrl } = await createEpayTopup(token, pkg.id);
            window.location.assign(checkoutUrl);
          } else {
            setYeepayOpen(true);
          }
        } else {
          setNotice("国际支付渠道正在接入中，请切换为 CNY 使用易支付充值。");
          setActivePackage(null);
        }
      } catch (err) {
        setNotice(
          err instanceof Error ? err.message : "创建订单失败，请重试。",
        );
      } finally {
        setLoadingPackageId(null);
      }
    },
    [session?.access_token, region],
  );

  const handleYeePaySuccess = useCallback(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h2 className="display-sm text-foreground">积分与充值</h2>
        <p className="mt-3 body-relaxed max-w-lg">
          一次性购买积分，永久有效。所有 AI 模型按需使用，按使用量消耗。
        </p>
      </div>

      {/* Balance hero */}
      <div className="rounded-2xl glass border border-border/40 p-6 sm:p-7">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="eyebrow">当前余额</p>
            <p className="mt-3 text-5xl font-extralight tabular-nums tracking-tighter text-foreground">
              {balance.toLocaleString()}
            </p>
            <p className="mt-1 text-sm text-muted-foreground font-light">可用积分</p>
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

      {/* Top-up packages */}
      <div>
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
              onClick={() => setRegion("international")}
              className={cn(
                "rounded-full px-3 py-1.5 transition-all duration-200",
                region === "international"
                  ? "bg-foreground text-background font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              🌐 USD
            </button>
            <button
              type="button"
              onClick={() => setRegion("china")}
              className={cn(
                "rounded-full px-3 py-1.5 transition-all duration-200",
                region === "china"
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
              />
            ))}
          </div>
        )}
      </div>

      {/* Transaction history */}
      <div>
        <h3 className="display-sm text-foreground mb-5">积分流水</h3>
        <CreditUsageHistory />
      </div>

      {/* YeePay dialog */}
      {session?.access_token && activePackage && (
        <YeePayCheckoutDialog
          open={yeepayOpen}
          onOpenChange={(open) => {
            setYeepayOpen(open);
            if (!open) setActivePackage(null);
          }}
          packageId={activePackage.id}
          packageLabel={activePackage.name}
          amountCnyFen={activePackage.priceCnyFen}
          accessToken={session.access_token}
          onSuccess={handleYeePaySuccess}
        />
      )}
    </div>
  );
}

function PackageCard({
  pkg,
  region,
  loading,
  onTopup,
}: {
  pkg: TopupPackage;
  region: "international" | "china";
  loading: boolean;
  onTopup: (pkg: TopupPackage) => void;
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
            最划算
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
        <span className="text-sm text-muted-foreground font-light">积分</span>
        {pkg.bonusCredits && (
          <span className="inline-flex items-center gap-0.5 rounded-full glass-soft border border-accent/30 px-2 py-0.5 text-[10px] font-medium text-foreground">
            +{pkg.bonusCredits.toLocaleString()} 加赠
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-muted-foreground/80 font-light">
        合计 {(pkg.credits + (pkg.bonusCredits ?? 0)).toLocaleString()} 积分 · 永久有效
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
            处理中...
          </>
        ) : (
          <>
            <Plus className="size-3.5" strokeWidth={1.5} />
            立即充值
          </>
        )}
      </button>
    </motion.div>
  );
}
