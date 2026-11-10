"use client";
import { useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { StyledSelect } from "./ui/styled-select";
import { desktopStorageError, type DesktopStorageApi, type SnapshotList } from "@/lib/desktop-storage";

export function DesktopSnapshotBrowser({ api, accountId, accessToken, disabled, onPreview }: { api: DesktopStorageApi; accountId: string | undefined; accessToken: string | undefined; disabled: boolean; onPreview: (id: string) => void }) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [catalog, setCatalog] = useState<SnapshotList | null>(null), [query, setQuery] = useState(""), [project, setProject] = useState("all"), [order, setOrder] = useState("newest"), [limit, setLimit] = useState(30);
  if (!api.listLocalSnapshots || !api.previewLocalSnapshot) return null;
  const refresh = async () => {
    if (!accountId || !accessToken) return;
    setLoading(true); setError("");
    try { setCatalog(await api.listLocalSnapshots!({ accountId, accessToken })); }
    catch (cause) { setError(desktopStorageError(cause)); setCatalog(null); }
    finally { setLoading(false); }
  };
  const browse = () => { setOpen(true); setProject("all"); setQuery(""); setLimit(30); void refresh(); };
  const projects = [...new Map(catalog?.snapshots.map(snapshot => [snapshot.projectId, snapshot.name]) ?? []).entries()];
  const snapshots = (catalog?.snapshots ?? []).filter(snapshot => (project === "all" || snapshot.projectId === project) && `${snapshot.name} ${snapshot.fileName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => (Date.parse(b.savedAt) - Date.parse(a.savedAt)) * (order === "newest" ? 1 : -1));
  return <>
    <button type="button" className="desktop-settings__command" onClick={browse} disabled={disabled || !accountId}><History aria-hidden="true"/>浏览本地快照</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>本地工程快照</DialogTitle><DialogDescription>选择工程和保存时间，预览画布、对话及素材后再确认恢复。</DialogDescription></DialogHeader>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-sm">查找快照<input type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(30); }} placeholder="工程名或文件名" className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-base"/></label>
          <label className="min-w-0 text-sm">工程<StyledSelect aria-label="筛选工程" value={project} onChange={value => { setProject(value); setLimit(30); }} options={[{ value: "all", label: "全部工程" }, ...projects.map(([value, label]) => ({ value, label: `${label} · ${value.slice(0, 8)}` }))]}/></label>
          <label className="min-w-0 text-sm">保存顺序<StyledSelect aria-label="保存顺序" value={order} onChange={setOrder} options={[{ value: "newest", label: "最新保存优先" }, { value: "oldest", label: "最早保存优先" }]}/></label>
          <button type="button" className="desktop-settings__command self-end justify-center" onClick={() => void refresh()} disabled={loading}><RefreshCw aria-hidden="true"/>刷新列表</button>
        </div>
        <div role="status" aria-live="polite" className="text-sm text-muted-foreground">{loading ? "正在读取本机快照…" : `${snapshots.length} 份快照`}</div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {catalog?.unreadable ? <p role="alert" className="text-sm text-muted-foreground">{catalog.unreadable} 份本地记录无法读取或不属于当前账户，原文件保留。</p> : null}
        {catalog?.truncated && <p className="text-sm text-muted-foreground">列表已达到本次读取上限；更早的快照仍可通过“从本地快照恢复工程”选择文件。</p>}
        {!loading && !error && !snapshots.length && <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">{catalog?.snapshots.length ? "没有匹配的快照，调整筛选后重试。" : "当前账户还没有本地快照。先保存云端数据到本地，或选择已有的工程 JSON 文件。"}</p>}
        {!loading && <ul className="max-h-[45vh] space-y-2 overflow-y-auto pr-1" aria-label="本地快照列表">{snapshots.slice(0, limit).map(snapshot => <li key={snapshot.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-border p-3">
          <div className="min-w-0 flex-1"><strong className="block break-words text-sm">{snapshot.name}</strong><time dateTime={snapshot.savedAt} className="mt-1 block text-xs tabular-nums text-muted-foreground">{new Date(snapshot.savedAt).toLocaleString()}</time><p className="mt-1 text-xs text-muted-foreground">{snapshot.elements} 个元素 · {snapshot.sessions} 个对话 · {snapshot.messages} 条消息 · {(snapshot.bytes / 1024).toFixed(1)} KiB</p><p className="mt-1 break-all text-xs text-muted-foreground">{snapshot.fileName}</p></div>
          <button type="button" className="desktop-settings__command shrink-0" aria-label={`预览 ${snapshot.name} ${new Date(snapshot.savedAt).toLocaleString()}`} onClick={() => { setOpen(false); onPreview(snapshot.id); }}>预览恢复</button>
        </li>)}</ul>}
        {snapshots.length > limit && <button type="button" className="desktop-settings__command justify-center" onClick={() => setLimit(value => value + 30)}>显示更多快照</button>}
      </DialogContent>
    </Dialog>
  </>;
}
