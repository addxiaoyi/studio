"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Settings, Zap, Shield, Clock } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { useCredits } from "@/hooks/use-credits";
import { TOPUP_PACKAGES, type TopupPackage } from "@helstera/shared";
import { YeePayCheckoutDialog } from "@/components/yeepay-checkout-dialog";

import { PricingNav } from "./components/pricing-nav";
import { PricingHero } from "./components/pricing-hero";
import { PricingFAQ } from "./components/pricing-faq";
import { TopupPackages } from "./components/topup-packages";

type PaymentRegion = "international" | "china";

function detectRegion(): PaymentRegion {
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

export default function PricingPage() {
  const [region, setRegion] = useState<PaymentRegion>("international");
  const [yeepayOpen, setYeepayOpen] = useState(false);
  const [activePackage, setActivePackage] = useState<TopupPackage | null>(null);
  const [loadingPackageId, setLoadingPackageId] = useState<string | null>(null);

  useEffect(() => {
    setRegion(detectRegion());
  }, []);

  const { session } = useAuth();
  const { balance, refresh: refreshCredits } = useCredits();

  // Only the enabled CNY channel can create a real top-up order.
  const handleSelectPackage = useCallback(
    async (pkg: TopupPackage) => {
      const token = session?.access_token;
      if (!token) {
        window.location.href = "/login?redirect=/pricing";
        return;
      }

      setLoadingPackageId(pkg.id);
      setActivePackage(pkg);

      try {
        if (region === "china") {
          setYeepayOpen(true);
        } else {
          alert("国际支付渠道正在接入中，请切换为中国大陆 (CNY)。");
          setActivePackage(null);
        }
      } catch (err) {
        console.error("[pricing] Topup order failed:", err);
        alert(err instanceof Error ? err.message : "创建订单失败");
      } finally {
        setLoadingPackageId(null);
      }
    },
    [session?.access_token, region],
  );

  const handleYeePaySuccess = useCallback(() => {
    refreshCredits();
  }, [refreshCredits]);

  const handleYeePayClose = useCallback(() => {
    setYeepayOpen(false);
    setActivePackage(null);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <PricingNav />

      <main>
        <PricingHero />

        {/* Current balance + region selector */}
        <section className="px-6">
          <div className="max-w-6xl mx-auto mb-12 flex flex-col items-center gap-6">
            <div className="inline-flex items-center gap-1 rounded-full glass-soft border border-border/40 p-1 text-xs">
              <button
                type="button"
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
                onClick={() => setRegion("china")}
                className={`rounded-full px-3 py-1.5 transition-all duration-200 ${
                  region === "china"
                    ? "bg-foreground text-background font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                🇨🇳 中国大陆 (CNY)
              </button>
            </div>

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

      {/* YeePay dialog (China only) */}
      {session?.access_token && activePackage && (
        <YeePayCheckoutDialog
          open={yeepayOpen}
          onOpenChange={(open) => {
            setYeepayOpen(open);
            if (!open) handleYeePayClose();
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
