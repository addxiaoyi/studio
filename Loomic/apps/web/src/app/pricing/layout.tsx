// app/pricing/layout.tsx — metadata for /pricing
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "按需充值 · 简单透明的定价",
  description:
    "Helstera 积分充值 — 没有订阅，没有月费。一次性购买积分，永久有效，按需消耗。所有 AI 模型通用：15+ 图片模型、8+ 视频模型。",
  keywords: [
    "AI 积分充值",
    "Helstera 定价",
    "按需付费",
    "AI 创意工具",
  ],
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Helstera 定价 · 按需充值",
    description:
      "没有订阅，没有月费。一次性购买积分，永久有效。所有 AI 模型通用。",
    url: "/pricing",
  },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
