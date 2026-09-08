// app/security/layout.tsx — security & compliance metadata
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "安全与合规",
  description:
    "Helstera 安全合规 — SOC 2 Type II、GDPR、CCPA、SSO/SCIM、私有化部署、端到端加密、数据驻留方案。",
  keywords: [
    "Helstera 安全",
    "SOC 2",
    "GDPR",
    "数据合规",
    "私有化部署",
  ],
  alternates: { canonical: "/security" },
  openGraph: {
    title: "Helstera 安全与合规",
    description:
      "企业级安全合规 — SOC 2 Type II、GDPR、CCPA、SSO/SCIM、私有化部署。",
    url: "/security",
  },
};

export default function SecurityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
