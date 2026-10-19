"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { fetchAdminDouyinMcpStatus, fetchAdminDouyinMcpTools } from "@/lib/server-api";

export default function DouyinMcpPage() {
  const { session } = useAuth();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof fetchAdminDouyinMcpStatus>>["data"] | null>(null);
  const [tools, setTools] = useState<Array<{ name: string; description?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    try {
      const current = await fetchAdminDouyinMcpStatus(session.access_token);
      setStatus(current.data);
      if (current.data.configured) setTools((await fetchAdminDouyinMcpTools(session.access_token)).data.tools);
      else setTools([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "抖音 MCP 状态读取失败");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">Douyin Integration</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">抖音 MCP</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">服务端 SSE 连接、白名单工具目录和调用前检查。Token 永不发送到浏览器。</p></div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-border/50 px-3 py-2 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />刷新</button>
      </header>
      {error && <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
      {loading && !status ? <div className="grid h-40 place-items-center rounded-2xl border border-border/40"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : status && <>
        <div className="grid gap-4 sm:grid-cols-4">
          <StatusCard label="连接模式" value="服务端 SSE" ok={status.mode === "server_side_sse"} />
          <StatusCard label="Token 配置" value={status.configured ? "已配置" : "未配置"} ok={status.configured} />
          <StatusCard label="允许工具" value={String(status.allowedTools.length)} ok={status.allowedTools.length > 0} />
        </div>
        <div className="rounded-2xl border border-border/40 bg-card/50 p-5 text-sm">Token 过期时间：{formatExpiry(status.credentials.clientTokenExpiresAt)}{status.credentials.lastError ? ` · ${status.credentials.lastError}` : ""}</div>
        <section className="rounded-2xl border border-border/40 bg-card/50 p-5"><div className="flex items-start justify-between gap-4"><div><h2 className="text-sm font-semibold">允许调用的工具</h2><p className="mt-1 text-xs text-muted-foreground">只有环境变量白名单中的工具可以被服务端调用。</p></div><span className="text-xs text-muted-foreground">{tools.length} 个已发现</span></div><div className="mt-5 space-y-3">{tools.length ? tools.map((tool) => <div key={tool.name} className="rounded-xl border border-border/40 p-4"><p className="font-mono text-xs font-medium">{tool.name}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{tool.description ?? "未提供描述"}</p></div>) : <p className="text-sm text-muted-foreground">暂无工具。配置 DOUYIN_MCP_CLIENT_TOKEN 后刷新。</p>}</div></section>
      </>}
    </section>
  );
}

function formatExpiry(value: string | null): string {
  if (!value) return "无法获取";
  const remainingMinutes = Math.max(0, Math.round((new Date(value).getTime() - Date.now()) / 60000));
  return remainingMinutes > 0 ? `${remainingMinutes} 分钟` : "已过期，请刷新";
}

function StatusCard({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return <div className="rounded-2xl border border-border/40 bg-card/50 p-5"><div className="flex items-center gap-2 text-xs text-muted-foreground">{ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <ShieldAlert className="size-4 text-amber-600" />}{label}</div><p className="mt-3 text-xl font-semibold">{value}</p></div>;
}
