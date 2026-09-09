"use client";

import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/landing/section-header";
import { StaggerContainer, scaleUp } from "@/components/landing/motion";

interface PricingPlan {
  name: string;
  badge?: string;
  price: string;
  period: string;
  features: string[];
  cta: string;
  highlighted: boolean;
}

const PLANS: PricingPlan[] = [
  {
    name: "免费版",
    price: "¥50",
    period: "永久免费",
    features: [
      "每月 10 次 AI 生成",
      "基础设计模板",
      "单项目空间",
      "社区支持",
    ],
    cta: "免费开始",
    highlighted: false,
  },
  {
    name: "标准包",
    badge: "最受欢迎",
    price: "¥200",
    period: "一次付费",
    features: [
      "无限 AI 生成",
      "全部 AI 模型",
      "无限项目空间",
      "品牌工具包",
      "优先支持",
      "高清导出",
    ],
    cta: "升级 Pro",
    highlighted: true,
  },
  {
    name: "专业包",
    price: "¥500",
    period: "一次付费",
    features: [
      "Pro 全部功能",
      "团队协作空间",
      "共享资源库",
      "管理控制台",
      "API 接入",
      "专属客户经理",
    ],
    cta: "联系我们",
    highlighted: false,
  },
];

function PricingCard({ plan }: { plan: PricingPlan }) {
  return (
    <motion.div
      variants={scaleUp}
      className={cn(
        "relative flex flex-col rounded-[1.5rem] border border-border/60 p-7 md:p-8",
        "transition-all duration-300 hover:-translate-y-1",
        plan.highlighted && "glass shadow-soft",
        !plan.highlighted && "glass-soft hover:glass",
      )}
    >
      {/* Badge */}
      {plan.badge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium tracking-wide bg-primary text-primary-foreground">
            {plan.badge}
          </span>
        </div>
      )}

      {/* Plan name */}
      <p className="text-base font-medium text-foreground">{plan.name}</p>

      {/* Price */}
      <div className="mt-5">
        <span className="text-4xl font-medium text-foreground tabular-nums tracking-tight">
          {plan.price}
        </span>
        <span className="ml-2 text-sm text-muted-foreground">
          {plan.period}
        </span>
      </div>

      {/* Divider */}
      <div className="mt-7 h-px bg-border/60" />

      {/* Features */}
      <ul className="mt-7 space-y-3.5 flex-1">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-3">
            <div className="size-4.5 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-primary/10">
              <Check className="size-2.5 text-primary" strokeWidth={2.5} />
            </div>
            <span className="text-sm text-muted-foreground leading-relaxed">{feature}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div className="mt-8">
        {plan.highlighted ? (
          <button
            className={cn(
              "w-full rounded-full py-3 text-sm font-medium",
              "bg-foreground text-background",
              "transition-all duration-300 hover:scale-[1.02] active:scale-[0.99]",
            )}
          >
            {plan.cta}
          </button>
        ) : (
          <button
            className={cn(
              "w-full rounded-full py-3 text-sm font-medium",
              "glass-soft hover:glass text-foreground",
              "transition-all duration-300",
            )}
          >
            {plan.cta}
          </button>
        )}
      </div>
    </motion.div>
  );
}

export function PricingPreview() {
  return (
    <section id="pricing" className="py-32 md:py-40 relative overflow-hidden">
      {/* Subtle dots grid background */}
      <div
        className="absolute inset-0 opacity-[0.035] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle, oklch(0.556 0 0) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-6">
        <div className="mb-24 md:mb-32">
          <SectionHeader
            title="按需充值额度"
            subtitle="一次购买，永久有效"
          />
        </div>

        <StaggerContainer className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          {PLANS.map((plan) => (
            <PricingCard key={plan.name} plan={plan} />
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}
