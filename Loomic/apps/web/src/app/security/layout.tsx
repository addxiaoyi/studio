// app/security/layout.tsx — security & compliance metadata
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "安全与数据使用说明",
  description:
    "了解 Helstera 的账号访问、私有素材、生成费用确认与安全问题反馈渠道。",
  keywords: [
    "Helstera 安全",
    "账号访问",
    "素材保留",
    "问题反馈",
  ],
  alternates: { canonical: "/security" },
  openGraph: {
    title: "Helstera 安全与数据使用说明",
    description:
      "账号、私有素材与生成费用的处理说明，以及安全问题反馈方式。",
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
