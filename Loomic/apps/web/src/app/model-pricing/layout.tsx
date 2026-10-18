import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "模型价格对比",
  description: "查看主流图片与视频模型的官方 API 价格、Helstera credits 消耗和价格来源。",
  alternates: { canonical: "/model-pricing" },
  openGraph: {
    title: "模型官方价格对比",
    description: "官方 API 费率与 Helstera credits 透明对比，附价格来源和更新状态。",
    url: "/model-pricing",
  },
};

export default function ModelPricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
