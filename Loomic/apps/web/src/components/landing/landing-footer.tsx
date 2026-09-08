"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { HelsteraLogo } from "@/components/icons/helstera-logo";

interface FooterColumn {
  title: string;
  links: { label: string; href: string }[];
}

const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: "产品",
    links: [
      { label: "功能介绍", href: "#features" },
      { label: "定价方案", href: "#pricing" },
      { label: "产品演示", href: "/demo" },
      { label: "API 文档", href: "/docs/api" },
    ],
  },
  {
    title: "解决方案",
    links: [
      { label: "品牌设计团队", href: "/solutions/brand" },
      { label: "市场营销团队", href: "/solutions/marketing" },
      { label: "内容创作者", href: "/solutions/creators" },
      { label: "企业内部", href: "/solutions/enterprise" },
    ],
  },
  {
    title: "资源",
    links: [
      { label: "帮助文档", href: "/docs" },
      { label: "设计博客", href: "/blog" },
      { label: "视频教程", href: "/tutorials" },
      { label: "模板市场", href: "/templates" },
    ],
  },
  {
    title: "公司",
    links: [
      { label: "关于我们", href: "/about" },
      { label: "加入团队", href: "/careers" },
      { label: "联系销售", href: "/contact-sales" },
      { label: "媒体资料", href: "/press" },
    ],
  },
  {
    title: "信任",
    links: [
      { label: "服务条款", href: "/terms" },
      { label: "隐私政策", href: "/privacy" },
      { label: "SLA 保障", href: "/sla" },
      { label: "安全合规", href: "/security" },
      { label: "服务状态", href: "/status" },
    ],
  },
];

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={cn("size-4", className)} aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={cn("size-4", className)} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function LandingFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-border/40 mt-32" role="contentinfo">
      <div className="max-w-6xl mx-auto px-6 pt-20 pb-12 md:pt-24">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-10">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="inline-flex items-center gap-2">
              <HelsteraLogo className="size-7" />
              <span className="font-medium tracking-tight">Helstera</span>
            </Link>

            <p className="mt-3 text-sm text-muted-foreground leading-relaxed font-light">
              企业级 AI 画布工作台
            </p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {["SOC 2", "GDPR", "ISO 27001"].map((badge) => (
                <span
                  key={badge}
                  className="inline-flex items-center rounded-full border border-border/40 px-2 py-0.5 text-[10px] tracking-wider text-muted-foreground/70 font-light"
                >
                  {badge}
                </span>
              ))}
            </div>

            <div className="mt-5 flex items-center gap-1.5">
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                className="inline-flex items-center justify-center size-7 rounded-md text-muted-foreground hover:text-foreground transition-all duration-300"
              >
                <GithubIcon />
              </a>
              <a
                href="https://x.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="X (Twitter)"
                className="inline-flex items-center justify-center size-7 rounded-md text-muted-foreground hover:text-foreground transition-all duration-300"
              >
                <XIcon />
              </a>
            </div>
          </div>

          {/* Link columns */}
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-sm font-medium text-foreground mb-5 tracking-tight">
                {col.title}
              </p>
              <ul className="space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-all duration-300 duration-200"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-20 pt-8 border-t border-border/40 flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-xs text-muted-foreground">
            &copy; {currentYear} Helstera. All rights reserved.
          </p>
          <span className="text-xs text-muted-foreground">简体中文</span>
        </div>
      </div>
    </footer>
  );
}
