import Link from "next/link";
import { ArrowLeft, Download, MonitorDown } from "lucide-react";

export const metadata = {
  title: "下载桌面端 | Helstera",
  description: "从 studio.0st.top 直接下载 Helstera 桌面端。",
};

const DESKTOP_DOWNLOADS = [
  { label: "Linux AppImage", detail: "x64 · 版本 0.2.0", href: "/downloads/Helstera-0.2.0.AppImage" },
  { label: "Windows 安装包", detail: "x64 · 版本 0.2.0", href: "/downloads/Helstera-0.2.0-Windows-x64.exe" },
  { label: "macOS 安装包", detail: "Intel · 版本 0.2.0", href: "/downloads/Helstera-0.2.0-macOS-x64.dmg" },
  { label: "macOS 安装包", detail: "Apple Silicon · 版本 0.2.0", href: "/downloads/Helstera-0.2.0-macOS-arm64.dmg" },
] as const;

export default function DownloadPage() {
  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground sm:py-12">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="size-4" aria-hidden="true" />
          返回首页
        </Link>

        <section className="mt-16 max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Helstera Desktop</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">下载桌面端</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
            安装包由 studio.0st.top 直接提供。桌面端包含本地浏览助手，可在授权后读取选定标签页的页面证据并生成网站介绍。
          </p>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Windows 与 Linux 桌面端会自动检查并下载更新；下载完成后可在应用内重启安装。macOS 更新目前请下载并安装新版本。
          </p>

          <div className="mt-10 grid gap-3 sm:grid-cols-2">
            {DESKTOP_DOWNLOADS.map((download, index) => (
              <a key={download.href} href={download.href} download className="group rounded-2xl border border-border/60 bg-card p-5 shadow-sm transition-colors hover:border-foreground/30 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
                    {index === 0 ? <MonitorDown className="size-5" aria-hidden="true" /> : <Download className="size-5" aria-hidden="true" />}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold">{download.label}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{download.detail}</p>
                  </div>
                </div>
                <span className="mt-5 block text-xs font-medium text-muted-foreground group-hover:text-foreground">从 studio.0st.top 下载 →</span>
              </a>
            ))}
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">所有安装包均由 studio.0st.top 直接提供，不跳转第三方站点。</p>
        </section>
      </div>
    </main>
  );
}
