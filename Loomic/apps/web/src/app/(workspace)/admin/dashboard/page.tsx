"use client";

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock3, RefreshCw, Server, Users, WalletCards } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { fetchAdminOverview, type AdminOverviewRange } from "@/lib/server-api";
import { AdminDashboardCharts } from "./admin-dashboard-charts";

type Overview = Awaited<ReturnType<typeof fetchAdminOverview>>["data"];

const shortcuts = [
  ["/admin/jobs", "任务中心", "处理队列、失败和死信任务", Clock3],
  ["/admin/providers", "模型与 Provider", "验证连接、模型和计费配置", Server],
  ["/admin/users", "用户与额度", "搜索用户、调整角色和余额", Users],
] as const;

function Metric({ label, value, hint, tone = "neutral" }: { label: string; value: string | number; hint: string; tone?: "neutral" | "good" | "bad" }) {
  return (
    <article className="rounded-lg border border-border/50 bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {tone === "good" ? <CheckCircle2 className="size-4 text-emerald-600" /> : tone === "bad" ? <AlertTriangle className="size-4 text-amber-600" /> : null}
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </article>
  );
}

export default function DashboardPage() {
  const { session } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [rangeDays, setRangeDays] = useState<AdminOverviewRange>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    try {
      setData((await fetchAdminOverview(session.access_token, rangeDays)).data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "运营数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token, rangeDays]);

  useEffect(() => { void load(); }, [load]);

  const failureRate = data?.jobs.total
    ? `${Math.round((data.jobs.failed / data.jobs.total) * 100)}%`
    : "0%";

  return (
    <section className="space-y-7 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">Operations overview</p>
          <h1 className="mt-2 text-3xl font-semibold">运营总览</h1>
          <p className="mt-2 text-sm text-muted-foreground">先看异常，再进入对应工作区处理。</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <RefreshCw aria-hidden="true" className="size-4" />{loading ? "加载中" : "刷新数据"}
        </button>
      </header>

      {error && <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="正在加载运营数据">
          {Array.from({ length: 8 }, (_, index) => <div key={index} className="h-32 rounded-lg bg-muted/60" />)}
        </div>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="失败率" value={failureRate} hint={`${data.jobs.failed} 个失败或待修复 / ${data.jobs.total} 个任务`} tone={data.jobs.failed > 0 ? "bad" : "good"} />
            <Metric label="进行中任务" value={data.jobs.active} hint="包含等待中的画布同步" tone={data.jobs.active > 0 ? "neutral" : "good"} />
            <Metric label="用户数" value={data.users} hint="当前注册用户" />
            <Metric label="生成额度消耗" value={data.creditsSpent.toLocaleString("zh-CN")} hint="累计生成扣费" />
          </div>

          {data.charts ? <AdminDashboardCharts data={data.charts} rangeDays={rangeDays} onRangeChange={setRangeDays} /> : <p role="status" className="rounded-md border border-border/50 px-4 py-3 text-sm text-muted-foreground">趋势数据暂不可用，请刷新重试。</p>}

          <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
            <section className="rounded-lg border border-border/50 bg-card p-5">
              <div className="flex items-center justify-between">
                <div><h2 className="font-semibold">业务规模</h2><p className="mt-1 text-xs text-muted-foreground">用户、项目和可用资产总量</p></div>
                <WalletCards aria-hidden="true" className="size-5 text-muted-foreground" />
              </div>
              <div className="mt-6 grid grid-cols-3 gap-3">
                {[["用户", data.users], ["项目", data.projects], ["资产", data.assets]].map(([label, value]) => (
                  <div key={String(label)} className="rounded-md bg-muted/50 p-4">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums">{value ?? "—"}</p>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-lg border border-border/50 bg-card p-5">
              <h2 className="font-semibold">需要处理</h2>
              <p className="mt-1 text-xs text-muted-foreground">从异常入口直接进入操作页</p>
              <div className="mt-5 space-y-3">
                <Link href="/admin/jobs" className="flex min-h-11 items-center justify-between rounded-md border border-border/40 p-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span>失败或待修复任务</span><span className="flex items-center gap-2 font-semibold tabular-nums">{data.jobs.failed}<ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" /></span>
                </Link>
                <Link href="/admin/providers" className="flex min-h-11 items-center justify-between rounded-md border border-border/40 p-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span>Provider 与模型</span><span className="flex items-center gap-2 font-semibold"><Server aria-hidden="true" className="size-4 text-muted-foreground" /><ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" /></span>
                </Link>
              </div>
            </section>
          </div>

          <section>
            <div className="mb-3"><h2 className="font-semibold">快速入口</h2><p className="mt-1 text-xs text-muted-foreground">按常见处理任务组织，而不是按技术表名组织。</p></div>
            <div className="grid gap-3 md:grid-cols-3">
              {shortcuts.map(([href, label, hint, Icon]) => <Link key={href} href={href} className="group rounded-lg border border-border/50 bg-card p-5 transition-colors hover:border-foreground/30 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
                <div className="mt-5 flex items-end justify-between gap-3"><div><h3 className="font-medium">{label}</h3><p className="mt-1 text-xs text-muted-foreground">{hint}</p></div><ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground group-hover:text-foreground" /></div>
              </Link>)}
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
