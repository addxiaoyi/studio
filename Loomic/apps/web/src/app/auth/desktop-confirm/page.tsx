"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";

import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { LoadingScreen } from "@/components/loading-screen";
import { useAuth } from "@/lib/auth-context";
import { confirmDesktopLogin } from "@/lib/local-auth";

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function DesktopConfirmContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const state = params.get("state") ?? "";
  const requestedCallbackUrl = params.get("callback") ?? undefined;
  const [busy, setBusy] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!STATE_PATTERN.test(state)) {
      setError("桌面登录请求无效，请回到 Helstera Desktop 重新发起。");
      return;
    }
    if (!loading && !user) {
      const redirect = `/auth/desktop-confirm/?state=${encodeURIComponent(state)}`;
      router.replace(`/login/?redirect=${encodeURIComponent(redirect)}`);
    }
  }, [loading, router, state, user]);

  useEffect(() => {
    if (!callbackUrl) return;
    window.location.assign(callbackUrl);
  }, [callbackUrl]);

  async function confirm() {
    if (!STATE_PATTERN.test(state) || busy) return;
    setBusy(true);
    setError(null);
    try {
      setCallbackUrl(await confirmDesktopLogin(state, requestedCallbackUrl));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法确认桌面登录，请重试。");
    } finally {
      setBusy(false);
    }
  }

  if (loading || (!user && !error)) return <LoadingScreen />;

  return (
    <AuthShell
      variant="desktop"
      title="确认桌面端登录"
      description="确认后，Helstera Desktop 会在本机完成登录。"
      features={["不会复制浏览器 Cookie", "授权码短时有效且只能使用一次", "仅将登录会话写入 Helstera Desktop"]}
    >
      <div className="space-y-5">
        <div className="rounded-lg border border-border/70 bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4 text-emerald-700" aria-hidden="true" />
            当前网页登录账号
          </div>
          <p className="mt-2 break-all text-sm text-muted-foreground">{user?.email ?? "未登录"}</p>
        </div>

        {callbackUrl ? (
          <a href={callbackUrl} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <ExternalLink className="size-4" aria-hidden="true" />
            打开 Helstera Desktop
          </a>
        ) : (
          <Button type="button" className="w-full" disabled={busy || !user || !STATE_PATTERN.test(state)} onClick={() => void confirm()}>
            {busy ? "正在生成一次性授权…" : "确认此账号登录桌面端"}
          </Button>
        )}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>
    </AuthShell>
  );
}

export default function DesktopConfirmPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <DesktopConfirmContent />
    </Suspense>
  );
}
