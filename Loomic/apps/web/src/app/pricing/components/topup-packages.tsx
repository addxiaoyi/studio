"use client";

import { motion } from "framer-motion";
import { Check, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TopupPackage } from "@helstera/shared";
import { TOPUP_PACKAGES } from "@helstera/shared";

interface TopupPackagesProps {
  region: "international" | "china";
  /** User's current credit balance, shown in subtitle. */
  currentBalance: number;
  /** User is logged in? Controls the CTA behavior. */
  isAuthenticated: boolean;
  onSelect?: (pkg: TopupPackage) => void;
  loadingPackageId?: string | null;
}

function formatPrice(pkg: TopupPackage, region: "international" | "china"): string {
  if (region === "china") {
    return `¥${(pkg.priceCnyFen / 100).toLocaleString()}`;
  }
  return `$${(pkg.priceUsdCents / 100).toLocaleString()}`;
}

function PackageCard({
  pkg,
  region,
  isAuthenticated,
  onSelect,
  loading,
}: {
  pkg: TopupPackage;
  region: "international" | "china";
  isAuthenticated: boolean;
  onSelect?: (pkg: TopupPackage) => void;
  loading: boolean;
}) {
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "relative flex flex-col rounded-[1.5rem] p-7 md:p-8 transition-all duration-300",
        pkg.highlighted
          ? "glass border border-foreground/15 shadow-card-hover"
          : "glass-soft border border-border/40 hover:glass hover:shadow-card",
      )}
    >
      {pkg.highlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-medium tracking-wide bg-foreground text-background">
            <Sparkles className="size-3" strokeWidth={1.5} />
            最划算
          </span>
        </div>
      )}

      {pkg.recommended && !pkg.highlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-medium tracking-wide bg-foreground text-background">
            推荐
          </span>
        </div>
      )}

      {/* Package name */}
      <h3 className="text-lg font-medium text-foreground tracking-tight">
        {pkg.name}
      </h3>

      {/* Price */}
      <div className="mt-4">
        <span className="text-5xl font-extralight tabular-nums tracking-tighter text-foreground">
          {formatPrice(pkg, region)}
        </span>
        <span className="ml-2 text-sm text-muted-foreground font-light">
          一次付费
        </span>
      </div>

      {/* Credits */}
      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-3xl font-light tabular-nums text-foreground tracking-tight">
          {pkg.credits.toLocaleString()}
        </span>
        <span className="text-sm text-muted-foreground font-light">积分</span>
        {pkg.bonusCredits && (
          <span className="inline-flex items-center gap-0.5 rounded-full glass-soft border border-accent/30 px-2 py-0.5 text-[10px] font-medium text-foreground">
            <Plus className="size-2.5" strokeWidth={2} />
            {pkg.bonusCredits.toLocaleString()} 加赠
          </span>
        )}
      </div>

      {/* Total credits display */}
      <p className="mt-2 text-xs text-muted-foreground/80 font-light">
        合计到账 {(pkg.credits + (pkg.bonusCredits ?? 0)).toLocaleString()} 积分 · 永久有效
      </p>

      {/* CTA */}
      <button
        type="button"
        disabled={loading || !onSelect}
        onClick={() => onSelect?.(pkg)}
        className={cn(
          "mt-6 w-full inline-flex items-center justify-center gap-2 rounded-full h-10 px-5 text-sm font-medium transition-all duration-300",
          pkg.highlighted
            ? "bg-foreground text-background hover:scale-[1.02] active:scale-[0.99]"
            : "glass-soft border border-border/40 hover:glass hover:scale-[1.01] active:scale-[0.99]",
        )}
      >
        {loading ? (
          <>
            <span className="size-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin" />
            处理中...
          </>
        ) : (
          <>
            <Plus className="size-3.5" strokeWidth={1.5} />
            {isAuthenticated ? "立即充值" : "登录后充值"}
          </>
        )}
      </button>

      {/* What you get — quick list */}
      <ul className="mt-6 space-y-2.5 text-sm text-muted-foreground">
        <li className="flex items-center gap-2.5 font-light">
          <Check className="size-3.5 text-foreground/50" strokeWidth={2} />
          <span>永不过期</span>
        </li>
        <li className="flex items-center gap-2.5 font-light">
          <Check className="size-3.5 text-foreground/50" strokeWidth={2} />
          <span>支持所有 AI 模型</span>
        </li>
        <li className="flex items-center gap-2.5 font-light">
          <Check className="size-3.5 text-foreground/50" strokeWidth={2} />
          <span>30 天内未使用可退</span>
        </li>
      </ul>
    </motion.div>
  );
}

export function TopupPackages({
  region,
  currentBalance,
  isAuthenticated,
  onSelect,
  loadingPackageId,
}: TopupPackagesProps) {
  return (
    <section className="py-24 md:py-32">
      <div className="max-w-6xl mx-auto px-6">
        {/* Section header */}
        <div className="mb-12 max-w-2xl">
          <p className="eyebrow mb-3">按需充值</p>
          <h2 className="display-lg text-foreground">
            简单透明的积分充值
          </h2>
          <p className="mt-5 body-relaxed">
            没有订阅、没有月费。一次性购买积分，永久有效，按使用量消耗。
            当前余额：<span className="font-medium text-foreground tabular-nums">{currentBalance.toLocaleString()}</span> 积分
          </p>
        </div>

        {/* Package grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {TOPUP_PACKAGES.map((pkg) => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              region={region}
              isAuthenticated={isAuthenticated}
              onSelect={onSelect ?? (() => {})}
              loading={loadingPackageId === pkg.id}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
