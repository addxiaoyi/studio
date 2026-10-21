"use client";

import { useEffect, useState } from "react";
import type { WebsiteCaptureAssistantConnection, WebsiteCapturePairing } from "@helstera/shared";
import { createWebsiteCapturePairing, fetchWebsiteAssistantConnection, revokeWebsiteAssistant, setWebsiteAssistantPaused } from "@/lib/server-api";

export function WebsiteAssistantSettings({ accessToken }: { accessToken: string }) {
  const [connection, setConnection] = useState<WebsiteCaptureAssistantConnection | null>(null);
  const [pairing, setPairing] = useState<WebsiteCapturePairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [embeddedUrl, setEmbeddedUrl] = useState("http://localhost:3000");
  const electronApi = typeof window !== "undefined"
    ? (window as Window & { electronAPI?: { openEmbeddedBrowser: (url: string) => Promise<{ ok: boolean }> } }).electronAPI
    : undefined;

  const refresh = async () => {
    try { setConnection(await fetchWebsiteAssistantConnection(accessToken)); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取助手状态"); }
  };
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 5000); return () => window.clearInterval(timer); }, [accessToken]);

  const createPairing = async () => {
    setBusy(true); setError(null);
    try { setPairing(await createWebsiteCapturePairing(accessToken)); } catch (cause) { setError(cause instanceof Error ? cause.message : "配对码创建失败"); } finally { setBusy(false); }
  };
  const togglePause = async () => {
    setBusy(true); setError(null);
    try { setConnection(await setWebsiteAssistantPaused(accessToken, !connection?.paused)); } catch (cause) { setError(cause instanceof Error ? cause.message : "助手状态更新失败"); } finally { setBusy(false); }
  };
  const revoke = async () => {
    setBusy(true); setError(null);
    try { await revokeWebsiteAssistant(accessToken); setConnection(null); setPairing(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "撤销失败"); } finally { setBusy(false); }
  };

  return (
    <section className="mt-8 rounded-xl border border-border/60 bg-card p-5" aria-labelledby="website-assistant-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="website-assistant-title" className="text-sm font-semibold">本地浏览器助手</h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">连接 Chrome 或 Edge 的当前标签页，让网站浏览任务读取登录态页面。Cookie、密码、OTP 和浏览器本地存储不会发送给 Helstera。</p>
        </div>
        <span role="status" className={`rounded-full border px-2.5 py-1 text-[11px] ${connection?.status === "connected" ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" : "border-border/60 text-muted-foreground"}`}>{connection?.status === "connected" ? "已连接" : connection?.status === "paused" ? "已暂停" : "未连接"}</span>
      </div>
      {connection ? <p className="mt-3 text-xs text-muted-foreground">{connection.browser} · {connection.platform} · 最近活动 {new Date(connection.lastSeenAt).toLocaleString()}</p> : null}
      {pairing ? <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3"><p className="text-xs font-medium">一次性配对码（10 分钟内有效）</p><code className="mt-2 block break-all text-lg font-semibold tracking-[0.18em]">{pairing.code}</code><p className="mt-2 break-all text-[11px] text-muted-foreground">WSS：{pairing.wssUrl}</p><p className="mt-2 text-[11px] leading-5 text-muted-foreground">{pairing.disclosure}</p></div> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void createPairing()} disabled={busy} className="min-h-10 rounded-md bg-foreground px-3 text-xs font-medium text-background disabled:opacity-50">生成配对码</button>
        {connection ? <button type="button" onClick={() => void togglePause()} disabled={busy} className="min-h-10 rounded-md border border-border/70 px-3 text-xs">{connection.paused ? "恢复连接" : "暂停浏览"}</button> : null}
        {connection ? <button type="button" onClick={() => void revoke()} disabled={busy} className="min-h-10 rounded-md border border-destructive/30 px-3 text-xs text-destructive">撤销并断开</button> : null}
      </div>
      {electronApi ? <div className="mt-4 rounded-lg border border-border/50 bg-muted/20 p-3"><p className="text-xs font-medium">桌面内嵌浏览器</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">使用独立浏览器分区打开本地站点；登录态留在桌面端，不会发送给服务器。</p><div className="mt-2 flex gap-2"><input aria-label="桌面内嵌浏览器 URL" value={embeddedUrl} onChange={(event) => setEmbeddedUrl(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-2 text-sm" /><button type="button" onClick={() => void electronApi.openEmbeddedBrowser(embeddedUrl).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "无法打开内嵌浏览器"))} className="min-h-9 rounded-md border border-border/70 px-2.5 text-xs">打开</button></div></div> : null}
      {error ? <p role="alert" className="mt-3 text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
