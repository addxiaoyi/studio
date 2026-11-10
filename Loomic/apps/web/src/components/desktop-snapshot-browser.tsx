"use client";
import { useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { StyledSelect } from "./ui/styled-select";
import { desktopStorageError, type DesktopStorageApi, type SnapshotList, type SnapshotOverview } from "@/lib/desktop-storage";

export function DesktopSnapshotBrowser({ api, accountId, accessToken, disabled, onPreview }: { api: DesktopStorageApi; accountId: string | undefined; accessToken: string | undefined; disabled: boolean; onPreview: (id: string) => void }) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [catalog, setCatalog] = useState<SnapshotList | null>(null), [query, setQuery] = useState(""), [project, setProject] = useState("all"), [order, setOrder] = useState("newest"), [limit, setLimit] = useState(30);
  const [selected, setSelected] = useState<string | null>(null), [overview, setOverview] = useState<SnapshotOverview | null>(null), [notice, setNotice] = useState("");
  if (!api.listLocalSnapshots || !api.previewLocalSnapshot) return null;
  const refresh = async () => {
    if (!accountId) return;
    setLoading(true); setError("");
    try { setCatalog(await api.listLocalSnapshots!({ accountId, accessToken: accessToken ?? "" })); }
    catch (cause) { setError(desktopStorageError(cause)); setCatalog(null); }
    finally { setLoading(false); }
  };
  const browse = () => { setOpen(true); setProject("all"); setQuery(""); setLimit(30); setSelected(null); setOverview(null); setNotice(""); void refresh(); };
  const inspect = async (id: string, baseline?: string) => {
    if (!accountId || !api.getLocalSnapshotOverview) { setOpen(false); onPreview(id); return; }
    setLoading(true); setError(""); setNotice("");
    try { setOverview(await api.getLocalSnapshotOverview(id, accountId, baseline)); setSelected(id); }
    catch (cause) { setError(desktopStorageError(cause)); }
    finally { setLoading(false); }
  };
  const queue = async () => { if (!selected || !accountId || !api.queueLocalSnapshot) return; try { await api.queueLocalSnapshot(selected, accountId); setNotice("已加入本地待恢复列表。联网后在恢复任务中确认继续。"); } catch (cause) { setError(desktopStorageError(cause)); } };
  const projects = [...new Map(catalog?.snapshots.map(snapshot => [snapshot.projectId, snapshot.name]) ?? []).entries()];
  const snapshots = (catalog?.snapshots ?? []).filter(snapshot => (project === "all" || snapshot.projectId === project) && `${snapshot.name} ${snapshot.fileName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => (Date.parse(b.savedAt) - Date.parse(a.savedAt)) * (order === "newest" ? 1 : -1));
  return <>
    <button type="button" className="desktop-settings__command" onClick={browse} disabled={disabled || !accountId}><History aria-hidden="true"/>浏览本地快照</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>本地工程快照</DialogTitle><DialogDescription>缩略图、历史对话和版本差异在本机读取，不上传云端。联网确认后才恢复到新画布。</DialogDescription></DialogHeader>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-sm">查找快照<input type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(30); }} placeholder="工程名或文件名" className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-base"/></label>
          <label className="min-w-0 text-sm">工程<StyledSelect aria-label="筛选工程" value={project} onChange={value => { setProject(value); setLimit(30); }} options={[{ value: "all", label: "全部工程" }, ...projects.map(([value, label]) => ({ value, label: `${label} · ${value.slice(0, 8)}` }))]}/></label>
          <label className="min-w-0 text-sm">保存顺序<StyledSelect aria-label="保存顺序" value={order} onChange={setOrder} options={[{ value: "newest", label: "最新保存优先" }, { value: "oldest", label: "最早保存优先" }]}/></label>
          <button type="button" className="desktop-settings__command self-end justify-center" onClick={() => void refresh()} disabled={loading}><RefreshCw aria-hidden="true"/>刷新列表</button>
        </div>
        <div role="status" aria-live="polite" className="text-sm text-muted-foreground">{loading ? "正在读取本机快照…" : `${snapshots.length} 份快照`}</div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
        {overview && selected && <section aria-label="快照版本预览" className="space-y-3 rounded-lg border p-3"><strong>{overview.name}</strong><img src={overview.thumbnail} alt="画布结构预览" className="aspect-video w-full rounded-md border bg-white object-contain"/><StyledSelect aria-label="对比快照版本" value={overview.baseline?.id ?? ""} onChange={value => void inspect(selected, value || undefined)} options={[{ value: "", label: "自动比较较早版本" }, ...overview.versions.map(version => ({ value: version.id, label: `${new Date(version.savedAt).toLocaleString()} · ${version.fileName}` }))]}/>{overview.difference ? <div className="text-sm"><p>元素：新增 {overview.difference.elements.added} · 修改 {overview.difference.elements.changed} · 移除 {overview.difference.elements.removed}</p><p>消息：新增 {overview.difference.messages.added} · 修改 {overview.difference.messages.changed} · 移除 {overview.difference.messages.removed}</p>{overview.difference.settingsChanged && <p>画布设置有变化</p>}{overview.difference.mediaChanged && <p>素材引用有变化</p>}</div> : <p className="text-sm text-muted-foreground">没有其他版本可比较。</p>}<details><summary className="cursor-pointer text-sm">查看画布文字和历史对话</summary><div className="mt-2 max-h-48 space-y-3 overflow-y-auto text-sm">{overview.text.map((text, i) => <p key={`text-${i}`} className="whitespace-pre-wrap break-words">{text}</p>)}{overview.messages.map((message, i) => <p key={`message-${i}`} className="whitespace-pre-wrap break-words"><strong>{message.role === "user" ? "用户" : "助手"}：</strong>{message.content}</p>)}{overview.truncated && <p>预览仅展示部分内容，完整记录保留在本地文件。</p>}</div></details><div className="flex flex-wrap gap-2"><button type="button" className="desktop-settings__command" onClick={() => { setOpen(false); onPreview(selected); }} disabled={loading || !accessToken}>联网检查并恢复</button>{api.queueLocalSnapshot && <button type="button" className="desktop-settings__command" disabled={loading} onClick={() => void queue()}>加入待恢复列表</button>}<button type="button" className="desktop-settings__command" onClick={() => { setSelected(null); setOverview(null); }}>收起预览</button></div></section>}
        {catalog?.unreadable ? <p role="alert" className="text-sm text-muted-foreground">{catalog.unreadable} 份本地记录无法读取或不属于当前账户，原文件保留。</p> : null}
        {catalog?.truncated && <p className="text-sm text-muted-foreground">列表已达到本次读取上限；更早的快照仍可通过“从本地快照恢复工程”选择文件。</p>}
        {!loading && !error && !snapshots.length && <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">{catalog?.snapshots.length ? "没有匹配的快照，调整筛选后重试。" : "当前账户还没有本地快照。先保存云端数据到本地，或选择已有的工程 JSON 文件。"}</p>}
        {!loading && <ul className="max-h-[45vh] space-y-2 overflow-y-auto pr-1" aria-label="本地快照列表">{snapshots.slice(0, limit).map(snapshot => <li key={snapshot.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-border p-3">
          {snapshot.thumbnail && <img src={snapshot.thumbnail} alt="画布结构缩略图" className="h-16 w-28 rounded-md border bg-white object-contain"/>}
          <div className="min-w-0 flex-1"><strong className="block break-words text-sm">{snapshot.name}</strong><time dateTime={snapshot.savedAt} className="mt-1 block text-xs tabular-nums text-muted-foreground">{new Date(snapshot.savedAt).toLocaleString()}</time><p className="mt-1 text-xs text-muted-foreground">{snapshot.elements} 个元素 · {snapshot.sessions} 个对话 · {snapshot.messages} 条消息 · {(snapshot.bytes / 1024).toFixed(1)} KiB</p><p className="mt-1 break-all text-xs text-muted-foreground">{snapshot.fileName}</p></div>
          <button type="button" className="desktop-settings__command shrink-0" aria-label={`预览 ${snapshot.name} ${new Date(snapshot.savedAt).toLocaleString()}`} onClick={() => void inspect(snapshot.id)}>预览恢复</button>
        </li>)}</ul>}
        {snapshots.length > limit && <button type="button" className="desktop-settings__command justify-center" onClick={() => setLimit(value => value + 30)}>显示更多快照</button>}
      </DialogContent>
    </Dialog>
  </>;
}
