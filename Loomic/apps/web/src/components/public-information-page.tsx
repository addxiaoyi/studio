import type { ReactNode } from "react";
import Link from "next/link";
import { HelsteraLogo } from "@/components/icons/helstera-logo";

export function PublicInformationPage({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#page-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded focus:bg-background focus:p-3">跳到主内容</a>
      <header className="border-b border-border">
        <nav aria-label="页面导航" className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <Link href="/" aria-label="Helstera 首页" className="inline-flex min-h-11 items-center rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><HelsteraLogo className="text-base" /></Link>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" href="/contact-sales/">联系我们</Link>
            <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" href="/login/">登录</Link>
          </div>
        </nav>
      </header>
      <main id="page-content" className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">{summary}</p>
        <p className="mt-3 text-sm text-muted-foreground">更新日期：2026 年 11 月 23 日</p>
        <div className="mt-10 space-y-9 break-words text-base leading-7 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:text-muted-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_a]:underline [&_a]:underline-offset-4 [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-ring">
          {children}
        </div>
      </main>
    </div>
  );
}
