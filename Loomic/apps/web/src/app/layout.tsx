import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

import { Providers } from "../components/providers";
import { PWAInstallPrompt } from "../components/pwa-install-prompt";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#15131c" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_WEB_ORIGIN ?? "https://helstera.com",
  ),
  title: {
    default: "Helstera — 企业级 AI 设计工作室",
    template: "%s | Helstera",
  },
  description: "Helstera 是新一代 AI 设计平台，支持企业品牌规范、多模态生成与团队协作。无限画布上，AI 直接生成图片、视频、文案并自动遵循品牌规范。",
  keywords: [
    "AI 设计平台",
    "AI 画布",
    "品牌一致性",
    "团队协作",
    "AI 图像生成",
    "AI 视频生成",
    "企业级设计",
    "企业 AI",
    "Helstera",
    "Brand Kit",
    "creative AI",
    "enterprise design",
  ],
  authors: [{ name: "Helstera", url: "https://helstera.com" }],
  creator: "Helstera",
  publisher: "Helstera",
  category: "DesignApplication",
  applicationName: "Helstera",
  referrer: "strict-origin-when-cross-origin",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Helstera",
  },
  alternates: {
    canonical: "/",
    languages: {
      "zh-CN": "/",
      en: "/",
    },
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: "/",
    siteName: "Helstera",
    title: "Helstera — 企业级 AI 设计工作室",
    description:
      "无限画布 · AI 直接生成图片、视频、文案并自动遵循品牌规范。设计师、文案、运营、市场在同一个画布上协作。",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Helstera — 企业级 AI 设计工作室",
        type: "image/svg+xml",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Helstera — 企业级 AI 设计工作室",
    description:
      "无限画布 · 品牌一致 · 团队实时协作 · 15+ AI 模型",
    images: ["/og-image.svg"],
    creator: "@helstera",
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: ["/favicon.svg"],
  },
  verification: {
    // 站点验证占位 — 上线时替换为真实 ID
    google: "",
    yandex: "",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className={cn(geist.variable, "scroll-smooth")} suppressHydrationWarning>
      <head>
        {/* Performance: preconnect to API + Supabase origins */}
        <link rel="preconnect" href={process.env.NEXT_PUBLIC_SERVER_BASE_URL ?? "http://localhost:3001"} />
        <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://*.supabase.co"} />
        <link rel="dns-prefetch" href="//cdn.jsdelivr.net" />

        {/* Performance: preload LCP image (Hero mockup) */}
        <link
          rel="preload"
          as="image"
          href="/images/showcase/showcase-12.jpg"
          fetchPriority="high"
        />

        {/* Theme color hint — must match <body> before paint */}
        <meta name="theme-color" content="#fbfaf8" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#15131c" media="(prefers-color-scheme: dark)" />
        <meta name="color-scheme" content="light dark" />
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>{children}</Providers>
        <PWAInstallPrompt />

        {/* Organization structured data — boosts search engine understanding */}
        <Script
          id="ld-json-org"
          type="application/ld+json"
          strategy="afterInteractive"
        >
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "Helstera",
            alternateName: "Helstera AI",
            url: process.env.NEXT_PUBLIC_WEB_ORIGIN ?? "https://helstera.com",
            logo: "/logo-helstera.png",
            description:
              "企业级 AI 画布工作台 — 多模态生成、品牌一致性管理、团队实时协作。",
            sameAs: [
              "https://github.com/helstera",
              "https://x.com/helstera",
            ],
            contactPoint: {
              "@type": "ContactPoint",
              contactType: "sales",
              availableLanguage: ["zh-Hans", "en"],
              url: "/contact-sales",
            },
          })}
        </Script>

        {/* SoftwareApplication structured data — for product search */}
        <Script
          id="ld-json-app"
          type="application/ld+json"
          strategy="afterInteractive"
        >
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Helstera",
            applicationCategory: "DesignApplication",
            operatingSystem: "Web, macOS, Windows",
            offers: {
              "@type": "Offer",
              price: "0",
              priceCurrency: "CNY",
              description: "免费注册，按需充值积分",
            },
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: "4.8",
              ratingCount: "127",
            },
          })}
        </Script>

        <Script
          src="https://app.lemonsqueezy.com/js/lemon.js"
          strategy="lazyOnload"
        />
        {/* Register Service Worker for PWA */}
        <Script id="sw-register" strategy="lazyOnload">
          {`
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js').catch(err => {
                  console.warn('SW registration failed:', err);
                });
              });
            }
          `}
        </Script>
      </body>
    </html>
  );
}
