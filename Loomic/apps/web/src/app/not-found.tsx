"use client";

import Link from "next/link";
import { Home, ArrowLeft, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { HelsteraLogo } from "@/components/icons/helstera-logo";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <div className="rounded-3xl glass-strong border border-border/40 p-12 max-w-md w-full">
        <div className="rounded-2xl glass-soft border border-border/40 p-5 w-fit mx-auto mb-6">
          <p className="display-lg text-foreground font-medium tracking-tight leading-none">
            404
          </p>
        </div>

        <h1 className="display-sm text-foreground mb-3">页面不存在</h1>
        <p className="text-muted-foreground text-sm font-light leading-relaxed mb-8">
          您访问的链接可能已失效或被移除。请选择以下方式继续：
        </p>

        <div className="flex flex-col gap-2.5 max-w-xs mx-auto">
          <Link
            href="/home"
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium",
              "bg-foreground text-background transition-all duration-300",
              "hover:scale-[1.02] active:scale-[0.99]",
            )}
          >
            <Home className="size-3.5" strokeWidth={1.5} />
            回到工作台
          </Link>
          <Link
            href="/pricing"
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium",
              "glass-soft border border-border/40 text-foreground transition-all duration-300",
              "hover:glass",
            )}
          >
            <Compass className="size-3.5" strokeWidth={1.5} />
            浏览充值套餐
          </Link>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") window.history.back();
            }}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-light",
              "text-muted-foreground transition-colors duration-200",
              "hover:text-foreground hover:bg-foreground/[0.04]",
            )}
          >
            <ArrowLeft className="size-3.5" strokeWidth={1.5} />
            返回上一页
          </button>
        </div>
      </div>

      <Link
        href="/"
        className="mt-12 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <HelsteraLogo className="size-5" />
        <span className="font-medium tracking-tight">Helstera</span>
      </Link>
    </div>
  );
}
