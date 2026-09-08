"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, RefreshCw, Home, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelsteraLogo } from "@/components/icons/helstera-logo";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    console.error("[Helstera] Unhandled error:", error);
  }, [error]);

  const copyError = async () => {
    const text = `Error: ${error.message}${error.digest ? `\nDigest: ${error.digest}` : ""}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <html lang="zh-CN">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
          <div className="rounded-3xl glass-strong border border-border/40 p-12 max-w-md w-full">
            <div className="rounded-2xl glass-soft border border-border/40 p-5 w-fit mx-auto mb-6">
              <AlertCircle
                className="size-7 text-destructive"
                strokeWidth={1.25}
                aria-hidden="true"
              />
            </div>

            <h1 className="display-sm text-foreground mb-3">出了点问题</h1>
            <p className="text-muted-foreground text-sm font-light leading-relaxed mb-6">
              页面渲染时遇到意外错误，请刷新重试。
            </p>

            {error.digest && (
              <div className="mb-4 flex items-center justify-center gap-2">
                <code className="text-xs text-muted-foreground/60 font-light font-mono">
                  错误代码: {error.digest}
                </code>
                <button
                  type="button"
                  onClick={copyError}
                  className="inline-flex items-center justify-center size-6 rounded-full glass-soft border border-border/40 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="复制错误信息"
                >
                  {copied ? (
                    <Check className="size-3 text-success" strokeWidth={2} />
                  ) : (
                    <Copy className="size-3" strokeWidth={1.5} />
                  )}
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                onClick={reset}
                variant="default"
                className="rounded-full"
              >
                <RefreshCw className="size-3.5 mr-1.5" strokeWidth={1.5} />
                重试
              </Button>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 rounded-full glass-soft hover:glass border border-border/40 px-5 py-2.5 text-sm font-medium text-foreground transition-all duration-300"
              >
                <Home className="size-3.5" strokeWidth={1.5} />
                返回首页
              </Link>
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
      </body>
    </html>
  );
}
