import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Laptop, ShieldCheck, Sparkles } from "lucide-react";

import { DesktopDownloadList } from "@/components/desktop-download-list";

export const metadata = {
  title: "Helstera Desktop 下载",
  description: "下载 Helstera 桌面版。Windows 提供免安装便携包，其他平台按发布状态提供下载。",
};

export default function DownloadPage() {
  return (
    <main className="min-h-screen bg-background px-5 py-7 text-foreground sm:px-8 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="size-4" aria-hidden="true" />
          返回 Helstera
        </Link>

        <section className="mt-10 grid gap-9 border-y border-border/70 py-8 sm:mt-14 sm:grid-cols-[minmax(0,1fr)_17rem] sm:gap-12 sm:py-10">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <Image src="/icons/icon-192.png" alt="" width={44} height={44} className="size-11 rounded-xl" priority unoptimized />
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">Helstera Desktop</p>
                <p className="mt-0.5 text-xs text-muted-foreground">AI 创作工作台</p>
              </div>
            </div>
            <h1 className="mt-7 text-3xl font-semibold sm:text-4xl">桌面端下载</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              在桌面使用 Helstera 网页工作区与本地浏览助手。安装包从 studio.0st.top 提供；尚未发布的平台会清楚标明状态。
            </p>

            <DesktopDownloadList />
          </div>

          <aside className="space-y-5 border-t border-border/70 pt-5 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0" aria-label="桌面端信息">
            <div className="flex gap-3">
              <Laptop className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-medium">Windows 免安装</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">下载 ZIP，解压后运行 Helstera.exe。无需管理员权限；应用数据保存在当前用户目录。</p>
              </div>
            </div>
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-medium">本机数据</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">登录凭据和浏览器配置保留在本机。仅在授权后，选中标签页的页面证据才会用于当前任务。</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-medium">安装版更新</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Windows 安装版与 Linux 安装包支持应用内更新。便携 ZIP 请在下载新版后重新解压。</p>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
