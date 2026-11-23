// app/contact-sales/layout.tsx — enterprise sales contact metadata
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "联系与咨询",
  description:
    "联系 Helstera 运营者，咨询使用方法、充值账单、退款与团队需求。",
  keywords: ["Helstera", "客服", "充值咨询", "团队需求"],
  alternates: { canonical: "/contact-sales" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "联系 Helstera",
    description:
      "提交使用问题、订单编号和团队需求，保留咨询编号以便跟进。",
    url: "/contact-sales",
  },
};

export default function ContactSalesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
