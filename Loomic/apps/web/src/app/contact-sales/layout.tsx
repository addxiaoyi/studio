// app/contact-sales/layout.tsx — enterprise sales contact metadata
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "企业销售咨询",
  description:
    "联系 Helstera 企业销售 — 定制 SLA、专属客户经理、私有化部署、数据驻留方案、SSO 集成。",
  keywords: ["Helstera 销售", "企业方案", "私有化部署", "SLA"],
  alternates: { canonical: "/contact-sales" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "联系 Helstera 企业销售",
    description:
      "定制 SLA、专属客户经理、私有化部署、SSO 集成。24 小时内回复。",
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
