"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

import { fetchAdminSection } from "@/lib/server-api";
import { useAuth } from "@/lib/auth-context";

const labels: Record<string, string> = {
  id: "ID", workspace_id: "工作区", actor_id: "操作者", action: "操作", target_type: "对象类型", target_id: "对象 ID",
  before_state: "变更前", after_state: "变更后", created_at: "时间", transaction_type: "流水类型", amount: "金额",
  balance_after: "变更后余额", description: "说明", amount_cny_fen: "金额（分）", provider: "支付渠道", status: "状态",
  event_name: "事件", provider_event_id: "渠道事件 ID", processed: "已处理", error_message: "错误信息", object_path: "文件路径",
  mime_type: "文件类型", byte_size: "文件大小", created_by: "创建者",
};

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5">{JSON.stringify(value, null, 2)}</pre>;
  if (typeof value === "string" && value.includes("T")) {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) return date.toLocaleString("zh-CN");
  }
  return String(value);
}

export function AdminDataPage({ section, title, description }: { section: "settings" | "uploads" | "audit" | "billing" | "payments" | "health" | "relays"; title: string; description: string }) {
  const { session } = useAuth();
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    void fetchAdminSection(session.access_token, section)
      .then((response) => setData(response.data))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "加载失败，请重试"))
      .finally(() => setLoading(false));
  }, [section, session?.access_token]);

  useEffect(() => { load(); }, [load]);

  const rows = Array.isArray(data) ? data : [];
  const visibleRows = rows.filter((row) => !query || JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));
  const objectData = data && !Array.isArray(data) && typeof data === "object" ? data as Record<string, unknown> : null;

  return (
    <section className="space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">Admin data</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p></div>
        <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-border/50 px-3 py-2 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />刷新</button>
      </header>
      {error && <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</div>}
      {loading ? <div className="grid gap-3 sm:grid-cols-2"><div className="h-28 animate-pulse rounded-2xl bg-muted/60" /><div className="h-28 animate-pulse rounded-2xl bg-muted/60" /><div className="h-48 animate-pulse rounded-2xl bg-muted/60 sm:col-span-2" /></div> : (
        <>
          {objectData && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(objectData).map(([key, value]) => <div key={key} className="rounded-2xl border border-border/40 bg-card/60 p-4"><p className="text-[11px] text-muted-foreground">{labels[key] ?? key}</p><div className="mt-2 text-lg font-semibold text-foreground">{formatValue(value)}</div></div>)}</div>}
          {rows.length > 0 && <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/50"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 p-4"><div><p className="text-sm font-medium text-foreground">记录</p><p className="mt-1 text-xs text-muted-foreground">{visibleRows.length} / {rows.length} 条</p></div><label className="relative block w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索记录" className="h-9 w-full rounded-lg border border-border/50 bg-background pl-9 pr-3 text-xs outline-none focus:border-foreground/40" /></label></div><div className="divide-y divide-border/30">{visibleRows.map((row, index) => <article key={index} className="grid gap-3 p-4 text-sm sm:grid-cols-[9rem_1fr]">{typeof row === "object" && row ? Object.entries(row as Record<string, unknown>).map(([key, value]) => <div key={key} className="grid gap-2 border-b border-border/20 py-1.5 last:border-0 sm:grid-cols-[9rem_1fr]"><span className="text-xs text-muted-foreground">{labels[key] ?? key}</span><span className="break-words text-foreground">{formatValue(value)}</span></div>) : <span>{formatValue(row)}</span>}</article>)}</div>{visibleRows.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">没有匹配记录</div>}</div>}
          {!objectData && rows.length === 0 && <div className="rounded-2xl border border-dashed border-border/50 p-12 text-center text-sm text-muted-foreground">暂无数据</div>}
        </>
      )}
    </section>
  );
}
