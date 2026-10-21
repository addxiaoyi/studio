import Link from "next/link";
import { ArrowLeft, Download, MonitorDown } from "lucide-react";

export const metadata = {
  title: "下载桌面端 | Helstera",
  description: "从 studio.0st.top 直接下载 Helstera 桌面端。",
};

const DESKTOP_APP_URL = "/downloads/Helstera-0.1.0.AppImage";

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

          <div className="mt-10 rounded-2xl border border-border/60 bg-card p-5 shadow-sm sm:p-6">
            <div className="flex items-start gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
                <MonitorDown className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold">Linux 桌面端</h2>
                <p className="mt-1 text-sm text-muted-foreground">AppImage · 版本 0.1.0</p>
              </div>
            </div>
            <a href={DESKTOP_APP_URL} download className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <Download className="size-4" aria-hidden="true" />
              下载 Linux AppImage
            </a>
            <p className="mt-3 text-center text-xs text-muted-foreground">下载地址与当前网站同源，不跳转第三方站点。</p>
          </div>
        </section>
      </div>
    </main>
  );
}
