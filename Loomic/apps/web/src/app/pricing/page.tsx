"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Settings, Zap, Shield, Clock } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { useCredits } from "@/hooks/use-credits";
import { createEpayTopup, isEpayEnabled } from "@/lib/credits-api";
import { TOPUP_PACKAGES, type TopupPackage } from "@helstera/shared";

import { PricingNav } from "./components/pricing-nav";
import { PricingHero } from "./components/pricing-hero";
import { PricingFAQ } from "./components/pricing-faq";
import { TopupPackages } from "./components/topup-packages";

type PaymentRegion = "international" | "china";

export default function PricingPage() {
  const [region, setRegion] = useState<PaymentRegion>("china");
  const [loadingPackageId, setLoadingPackageId] = useState<string | null>(null);

  const { session } = useAuth();
  const { balance } = useCredits();

  // Only the enabled CNY channel can create a real top-up order.
  const handleSelectPackage = useCallback(
    async (pkg: TopupPackage) => {
      const token = session?.access_token;
      if (!token) {
        window.location.href = "/login?redirect=/pricing";
        return;
      }

      setLoadingPackageId(pkg.id);

      try {
        if (region === "china" && isEpayEnabled()) {
          const { checkoutUrl } = await createEpayTopup(token, pkg.id, "alipay");
          window.location.assign(checkoutUrl);
        } else {
          alert("国际支付渠道正在接入中，请切换为中国大陆 (CNY)。");
        }
      } catch (err) {
        console.error("[pricing] Topup order failed:", err);
        alert(err instanceof Error ? err.message : "创建订单失败");
      } finally {
        setLoadingPackageId(null);
      }
    },
    [region, session?.access_token],
  );

  return (
    <div className="min-h-screen bg-background">
      <PricingNav />

      <main>
        <PricingHero />

        {/* Current balance + region selector */}
        <section className="px-6">
          <div className="max-w-6xl mx-auto mb-12 flex flex-col items-center gap-3">
            <fieldset className="inline-flex items-center gap-1 rounded-full glass-soft border border-border/40 p-1 text-xs">
              <legend className="sr-only">支付地区</legend>
              <button
                type="button"
                aria-pressed={region === "international"}
                onClick={() => setRegion("international")}
                className={`rounded-full px-3 py-1.5 transition-all duration-200 ${
                  region === "international"
                    ? "bg-foreground text-background font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                🌐 International (USD)
              </button>
              <button
                type="button"
                aria-pressed={region === "china"}
                onClick={() => setRegion("china")}
                className={`rounded-full px-3 py-1.5 transition-all duration-200 ${
                  region === "china"
                    ? "bg-foreground text-background font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                🇨🇳 中国大陆 (CNY)
              </button>
            </fieldset>
            {region === "international" ? (
              <output aria-live="polite" className="text-xs text-amber-700 dark:text-amber-300">
                国际支付渠道正在接入中；当前可切换到中国大陆 (CNY) 使用易支付。
              </output>
            ) : null}

            {session?.access_token && (
              <div className="inline-flex items-center gap-3 rounded-full glass-soft border border-border/40 px-5 py-2 text-sm">
                <Zap
                  className="size-3.5 text-accent"
                  strokeWidth={1.5}
                  fill="currentColor"
                />
                <span className="text-muted-foreground font-light">
                  当前积分：
                </span>
                <span className="font-medium tabular-nums text-foreground">
                  {balance.toLocaleString()}
                </span>
                <Link
                  href="/settings?tab=billing"
                  className="ml-1 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Settings className="size-3" strokeWidth={1.5} />
                </Link>
              </div>
            )}
          </div>

          <TopupPackages
            region={region}
            currentBalance={balance}
            isAuthenticated={!!session?.access_token}
            onSelect={handleSelectPackage}
            loadingPackageId={loadingPackageId}
          />
        </section>

        <section className="border-y border-border/60 px-6 py-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">PRICE TRANSPARENCY</p>
              <h2 className="mt-2 text-xl font-medium tracking-tight">先对比模型，再决定怎么用</h2>
              <p className="mt-1 text-sm text-muted-foreground">查看官方 API 计费单位、Helstera credits 参考和价格来源。</p>
            </div>
            <Link href="/model-pricing/" className="inline-flex h-10 w-fit items-center gap-2 rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted">
              查看模型价格
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </section>

        {/* Trust pillars */}
        <section className="py-24 md:py-32">
          <div className="max-w-5xl mx-auto px-6">
            <div className="mb-12 max-w-2xl">
              <p className="eyebrow mb-3">为什么选择按量付费</p>
              <h2 className="display-md text-foreground">
                没有月费 · 没有锁定
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                {
                  icon: Zap,
                  title: "用多少算多少",
                  desc: "模型差异化定价：图片 5-12 积分/张，视频 40-60 积分/5s。",
                },
                {
                  icon: Shield,
                  title: "无自动扣费",
                  desc: "积分用完才提醒，永不悄悄扣款。",
                },
                {
                  icon: Clock,
                  title: "永久有效",
                  desc: "30 天内未使用可全额退款，0 过期焦虑。",
                },
              ].map((p) => (
                <div key={p.title} className="rounded-2xl glass-soft border border-border/40 p-6">
                  <p.icon
                    className="size-5 text-foreground/60 mb-3"
                    strokeWidth={1.5}
                  />
                  <h3 className="text-base font-medium text-foreground tracking-tight">
                    {p.title}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground font-light leading-relaxed">
                    {p.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <PricingFAQ />
      </main>

    </div>
  );
}
