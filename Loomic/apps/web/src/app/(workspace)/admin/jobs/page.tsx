"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { fetchAdminJobs, mutateAdminJob } from "@/lib/server-api";
import { StyledSelect } from "@/components/ui/styled-select";

const statusNames: Record<string, string> = { queued: "排队中", running: "运行中", succeeded: "成功", failed: "失败", dead_letter: "死信", canceled: "已取消" };

export default function Page() {
  const { session } = useAuth();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchAdminJobs>>["data"]>([]);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  async function load() {
    if (!session?.access_token) return;
    try { setRows((await fetchAdminJobs(session.access_token, { status, page, pageSize: 20 })).data); }
    catch (error) { setNotice(error instanceof Error ? error.message : "任务加载失败"); }
  }
  useEffect(() => { void load(); }, [session?.access_token, status, page]);
  async function mutate(id: string, action: "retry" | "cancel") {
    if (!session?.access_token) return;
    try { await mutateAdminJob(session.access_token, id, action); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "任务操作失败"); }
  }
  return <section className="mx-auto max-w-6xl space-y-6 p-6 md:p-10">
    <div><h1 className="display-md">任务管理</h1><p className="text-muted-foreground">全局查看任务、扣费、失败和退款关联。</p></div>
    <StyledSelect value={status} onChange={(value) => { setStatus(value); setPage(1); }} aria-label="任务状态" options={[{ value: "", label: "全部状态" }, ...Object.entries(statusNames).map(([value, label]) => ({ value, label }))]} />
    {notice && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800">{notice}</p>}
    <div className="space-y-3">{rows.map((row) => <article key={row.id} className="rounded-xl border border-border/50 bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>{row.job_type}</strong><span>{statusNames[row.status] ?? row.status}</span></div>
      <p className="mt-2 text-xs text-muted-foreground">{row.id} · {new Date(row.created_at).toLocaleString("zh-CN")} · 重试 {row.attempt_count}/{row.max_attempts}</p>
      <p className="mt-2 text-sm">扣费：{row.credits_cost == null ? "未扣费" : `${row.credits_cost} 积分`} · 交易：{row.credits_transaction_id ?? "无"} · 退款：{row.refund_amount == null ? "无" : `${row.refund_amount} 积分`}</p>
      {row.error_message && <p className="mt-2 text-sm text-destructive">{row.error_code ? `${row.error_code}: ` : ""}{row.error_message}</p>}
      <div className="mt-3 flex gap-2">{(row.status === "failed" || row.status === "dead_letter") && <button type="button" onClick={() => void mutate(row.id, "retry")} className="rounded-md border px-3 py-1.5 text-xs">重试</button>}{(row.status === "queued" || row.status === "running") && <button type="button" onClick={() => void mutate(row.id, "cancel")} className="rounded-md border px-3 py-1.5 text-xs">取消</button>}</div>
    </article>)}</div>
    <div className="flex gap-2"><button type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">上一页</button><span className="px-3 py-2 text-sm">第 {page} 页</span><button type="button" disabled={rows.length < 20} onClick={() => setPage((current) => current + 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">下一页</button></div>
  </section>;
}
