"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Coins, RefreshCw, Search, ShieldCheck, Trash2, UserRound, UsersRound, X } from "lucide-react";
import { StyledSelect } from "@/components/ui/styled-select";
import { useAuth } from "@/lib/auth-context";
import { adjustAdminUserCredits, deleteAdminUser, fetchAdminUsers, updateAdminUserRole } from "@/lib/server-api";

type UserRow = { id: string; email: string; display_name: string | null; created_at: string; workspaces: string; workspace_id: string | null; role: string; balance: number };
type RoleFilter = "all" | "owner" | "admin" | "member";

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleDateString("zh-CN");
}

function formatBalance(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

export default function UsersPage() {
  const { session } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditUser, setCreditUser] = useState<UserRow | null>(null);
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("管理员调整");
  const [savingCredits, setSavingCredits] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const load = useCallback(async (showRefresh = false) => {
    if (!session?.access_token) return;
    setError(null);
    if (showRefresh) setRefreshing(true); else setLoading(true);
    try {
      const response = await fetchAdminUsers(session.access_token, { ...(query ? { q: query } : {}), pageSize: 50 });
      setRows(response.data as UserRow[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "用户列表加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query, session?.access_token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query === "" ? 0 : 250);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  const visibleRows = useMemo(() => rows.filter((user) => roleFilter === "all" || user.role === roleFilter), [roleFilter, rows]);
  const stats = useMemo(() => ({
    total: rows.length,
    admins: rows.filter((user) => user.role === "admin" || user.role === "owner").length,
    members: rows.filter((user) => user.role === "member").length,
    balance: rows.reduce((sum, user) => sum + Number(user.balance || 0), 0),
  }), [rows]);

  async function changeRole(user: UserRow, role: "admin" | "member") {
    if (!session?.access_token || user.role === role) return;
    setBusyUserId(user.id);
    setError(null);
    try { await updateAdminUserRole(session.access_token, user.id, role); await load(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "角色更新失败"); }
    finally { setBusyUserId(null); }
  }

  async function saveCredits() {
    if (!session?.access_token || !creditUser?.workspace_id || !Number.isInteger(amount) || amount === 0) return;
    setSavingCredits(true);
    setError(null);
    try {
      await adjustAdminUserCredits(session.access_token, creditUser.id, { workspaceId: creditUser.workspace_id, amount, reason: reason.trim() || "管理员调整" });
      setCreditUser(null);
      await load(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "额度调整失败"); }
    finally { setSavingCredits(false); }
  }

  async function removeUser(user: UserRow) {
    if (!session?.access_token || user.role === "owner") return;
    if (!window.confirm(`确认删除 ${user.email}？该用户的关联数据也可能受到影响。`)) return;
    setBusyUserId(user.id);
    setError(null);
    try { await deleteAdminUser(session.access_token, user.id); await load(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "删除用户失败"); }
    finally { setBusyUserId(null); }
  }

  return (
    <section className="space-y-7 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">Operations / Accounts</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">用户与额度</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">查看用户、工作区归属和当前余额，并在同一处完成角色与额度维护。</p></div>
        <button type="button" onClick={() => void load(true)} disabled={loading || refreshing} className="inline-flex h-9 items-center gap-2 rounded-xl border border-border/60 px-3 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"><RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />刷新数据</button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[{ label: "已加载用户", value: stats.total, hint: "当前查询结果", icon: UsersRound }, { label: "管理员与所有者", value: stats.admins, hint: "高权限账号", icon: ShieldCheck }, { label: "普通成员", value: stats.members, hint: "可参与工作区", icon: UserRound }, { label: "查询结果余额", value: formatBalance(stats.balance), hint: "积分合计", icon: Coins }].map(({ label, value, hint, icon: Icon }) => <div key={label} className="rounded-2xl border border-border/50 bg-card/70 p-4"><div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{label}</p><Icon className="size-4 text-muted-foreground/70" /></div><p className="mt-4 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{hint}</p></div>)}
      </div>

      <div className="rounded-2xl border border-border/50 bg-card/60 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">账号目录</h2><p className="mt-1 text-xs text-muted-foreground">最多展示接口返回的 50 条结果，搜索会在服务端执行。</p></div><p className="text-xs text-muted-foreground">显示 {visibleRows.length} / {rows.length}</p></div><div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]"><label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={searchInput} onChange={(event) => { setSearchInput(event.target.value); setQuery(event.target.value.trim()); }} placeholder="搜索邮箱或显示名称" className="h-11 w-full rounded-xl border border-border/60 bg-background pl-10 pr-3 text-sm outline-none transition focus:border-foreground/40" /></label><StyledSelect value={roleFilter} onChange={(value) => setRoleFilter(value as RoleFilter)} aria-label="按角色筛选" options={[{ value: "all", label: "全部角色" }, { value: "owner", label: "所有者" }, { value: "admin", label: "管理员" }, { value: "member", label: "成员" }]} /></div></div>

      {error && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>{error}</span></div>}
      {loading ? <div className="grid gap-3"><div className="h-20 animate-pulse rounded-2xl bg-muted/60" /><div className="h-64 animate-pulse rounded-2xl bg-muted/60" /></div> : visibleRows.length === 0 ? <div className="rounded-2xl border border-dashed border-border/60 p-14 text-center"><UsersRound className="mx-auto size-8 text-muted-foreground/50" /><p className="mt-3 text-sm font-medium">没有匹配的用户</p><p className="mt-1 text-xs text-muted-foreground">调整搜索词或角色筛选后再试。</p></div> : <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/60"><div className="hidden grid-cols-[minmax(16rem,1.5fr)_1fr_9rem_8rem_12rem] gap-4 border-b border-border/40 px-5 py-3 text-[11px] font-medium text-muted-foreground md:grid"><span>用户</span><span>工作区</span><span>角色</span><span>余额</span><span className="text-right">操作</span></div><div className="divide-y divide-border/30">{visibleRows.map((user) => { const busy = busyUserId === user.id; return <article key={user.id} className="grid gap-4 p-4 sm:p-5 md:grid-cols-[minmax(16rem,1.5fr)_1fr_9rem_8rem_12rem] md:items-center md:gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{user.display_name || "未设置名称"}</span>{user.role === "owner" && <span className="rounded-full bg-foreground/8 px-2 py-0.5 text-[10px] text-muted-foreground">所有者</span>}</div><p className="mt-1 truncate text-xs text-muted-foreground">{user.email}</p><p className="mt-1 text-[11px] text-muted-foreground/70">加入于 {formatDate(user.created_at)}</p></div><div><p className="text-[11px] text-muted-foreground md:hidden">工作区</p><p className="mt-1 text-sm md:mt-0">{user.workspaces || "未加入工作区"}</p></div><div><p className="text-[11px] text-muted-foreground md:hidden">角色</p><StyledSelect value={user.role} disabled={busy || user.role === "owner"} onChange={(value) => void changeRole(user, value as "admin" | "member")} aria-label={`${user.email} 的角色`} options={[{ value: "owner", label: "所有者" }, { value: "admin", label: "管理员" }, { value: "member", label: "成员" }]} /></div><div><p className="text-[11px] text-muted-foreground md:hidden">余额</p><p className="mt-1 text-sm font-medium tabular-nums md:mt-0">{formatBalance(user.balance)}</p></div><div className="flex justify-end gap-2"><button type="button" disabled={busy || !user.workspace_id} onClick={() => { setCreditUser(user); setAmount(0); setReason("管理员调整"); }} className="rounded-lg border border-border/60 px-3 py-2 text-xs transition hover:bg-muted disabled:opacity-40">调整额度</button><button type="button" disabled={busy || user.role === "owner"} onClick={() => void removeUser(user)} aria-label={`删除 ${user.email}`} className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-2 text-xs text-destructive transition hover:bg-destructive/5 disabled:opacity-40"><Trash2 className="size-3.5" />删除</button></div></article>; })}</div></div>}

      {creditUser && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingCredits) setCreditUser(null); }}><div role="dialog" aria-modal="true" aria-labelledby="credit-dialog-title" className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 id="credit-dialog-title" className="text-lg font-semibold">调整用户额度</h2><p className="mt-1 text-sm text-muted-foreground">{creditUser.email} · 当前余额 {formatBalance(creditUser.balance)}</p></div><button type="button" onClick={() => setCreditUser(null)} disabled={savingCredits} aria-label="关闭" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"><X className="size-4" /></button></div><label className="mt-6 block text-sm font-medium">调整数量<span className="ml-1 text-xs font-normal text-muted-foreground">正数增加，负数扣减</span><input type="number" step="1" value={amount} onChange={(event) => setAmount(Number(event.target.value))} className="mt-2 h-11 w-full rounded-xl border border-border/60 bg-background px-3 text-sm" /></label><label className="mt-4 block text-sm font-medium">调整原因<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} className="mt-2 h-11 w-full rounded-xl border border-border/60 bg-background px-3 text-sm" /></label><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setCreditUser(null)} disabled={savingCredits} className="rounded-xl border border-border/60 px-4 py-2 text-sm">取消</button><button type="button" onClick={() => void saveCredits()} disabled={savingCredits || !Number.isInteger(amount) || amount === 0} className="rounded-xl bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40">{savingCredits ? "保存中…" : "确认调整"}</button></div></div></div>}
    </section>
  );
}
