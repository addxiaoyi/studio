"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { DesktopDiskUsage } from "./desktop-disk-usage";
import { desktopStorageError, type CloudCopy, type CloudReleasePlan, type DesktopSetupState, type DesktopStorageApi, type LocalCleanupPlan, type LocalProjectStorage } from "@/lib/desktop-storage";

const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} B`;
export function DesktopStorageManagement({ api, accountId, accessToken, disabled, setup }: { api: DesktopStorageApi; accountId?: string | undefined; accessToken?: string | undefined; disabled: boolean; setup: DesktopSetupState | null }) {
  const [open, setOpen] = useState(false), [mode, setMode] = useState<"local" | "cloud">("local");
  const [disk, setDisk] = useState<DesktopSetupState | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [projects, setProjects] = useState<LocalProjectStorage[]>([]), [copies, setCopies] = useState<CloudCopy[]>([]);
  const [cleanup, setCleanup] = useState<LocalCleanupPlan | null>(null), [release, setRelease] = useState<CloudReleasePlan | null>(null), [accepted, setAccepted] = useState(false);
  if (!api.getLocalProjects || !api.previewLocalCleanup || !api.applyLocalCleanup) return null;
  const capacity = disk ?? setup;
  const credentials = accountId && accessToken ? { accountId, accessToken } : null;
  const load = async (target: "local" | "cloud") => {
    if (!accountId) return;
    setBusy(true); setError(""); setCleanup(null); setRelease(null); setAccepted(false);
    try {
      setDisk(await api.getDesktopSetup());
      if (target === "local") setProjects(await api.getLocalProjects!(accountId));
      else if (credentials && api.getLocalCloudCopies) setCopies(await api.getLocalCloudCopies(credentials));
      else throw new Error("请联网登录后管理云端副本。");
    } catch (cause) { setError(desktopStorageError(cause)); }
    finally { setBusy(false); }
  };
  const browse = () => { setOpen(true); setMode("local"); setNotice(""); void load("local"); };
  const inspect = async (id: string) => {
    if (!accountId) return;
    setBusy(true); setError(""); setNotice(""); setAccepted(false);
    try {
      if (mode === "local") setCleanup(await api.previewLocalCleanup!(accountId, id));
      else if (credentials && api.previewCloudRelease) setRelease(await api.previewCloudRelease(id, credentials));
    } catch (cause) { setError(desktopStorageError(cause)); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!accepted) return;
    setBusy(true); setError("");
    try {
      if (cleanup) {
        const cleared = await api.applyLocalCleanup!(cleanup.id);
        setNotice(`已清理 ${cleared.removedFiles} 个本地文件，合计 ${size(cleared.removedBytes)}。${cleared.errors.join(" ")}`);
      } else if (release && credentials && api.applyCloudRelease) {
        const cleared = await api.applyCloudRelease(release.id, credentials);
        setNotice(cleared.state === "released" ? `已释放 ${size(cleared.bytes)} 云端副本。本地原文件保留。` : "云端副本已停止提供访问，空间清理仍在处理；本地原文件保留，可稍后重试。");
      }
      await load(mode);
    } catch (cause) { setError(desktopStorageError(cause)); setCleanup(null); setRelease(null); }
    finally { setBusy(false); setAccepted(false); }
  };
  const plan = cleanup ?? release;
  return <div className="mt-4 space-y-3">
    {capacity?.availableBytes !== undefined && <div className="rounded-lg border p-3 text-sm" role={capacity.diskWarning && capacity.diskWarning !== "normal" ? "alert" : "status"}>
      <p>本地磁盘可用 {size(capacity.availableBytes)}{capacity.capacityBytes ? ` / ${size(capacity.capacityBytes)}` : ""}</p>
      {capacity.diskWarning === "critical" && <p className="mt-1 text-destructive">空间已严重不足，请先清理旧工程或选择另一块磁盘，再保存大文件。</p>}
      {capacity.diskWarning === "low" && <p className="mt-1 text-muted-foreground">可用空间偏低，建议整理旧工程，避免录像或下载中断。</p>}
    </div>}
    <button type="button" className="desktop-settings__command" disabled={disabled || !accountId} onClick={browse}>管理本地空间与云端副本</button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="sm:max-w-2xl" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>存储管理</DialogTitle><DialogDescription>本地原文件由当前工作区保管。先检查具体范围，再确认清理。</DialogDescription></DialogHeader>
      {accountId && <DesktopDiskUsage api={api} accountId={accountId}/>}
      <div className="flex flex-wrap gap-2" aria-label="存储位置">
        <button type="button" className="desktop-settings__command" aria-pressed={mode === "local"} disabled={busy} onClick={() => { setMode("local"); setNotice(""); void load("local"); }}>清理本地工程</button>
        {api.getLocalCloudCopies && <button type="button" className="desktop-settings__command" aria-pressed={mode === "cloud"} disabled={busy} onClick={() => { setMode("cloud"); setNotice(""); void load("cloud"); }}>释放云端副本</button>}
      </div>
      {busy && <p role="status">正在读取并校验文件，请稍候…</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
      {plan ? <section className="space-y-3 rounded-lg border p-4" aria-label="清理确认">
        <strong className="block break-words">{plan.name}</strong>
        {cleanup ? <><p>{cleanup.snapshots} 份快照、{cleanup.mediaFiles} 个专属素材，合计 {size(cleanup.bytes)}。</p><p>保留其他工程共用的 {cleanup.sharedMedia} 个素材。云端工程和素材不变。</p>{(cleanup.canceledTasks ?? 0) > 0 && <p>同时移除 {cleanup.canceledTasks} 条尚未上传的待恢复记录。</p>}<details><summary>查看文件清单</summary><ul className="mt-2 max-h-36 overflow-y-auto text-xs">{cleanup.files.map(name => <li key={name} className="break-all">{name}</li>)}</ul></details></> : <><p>本地原文件已经按大小和 SHA-256 重新校验，合计 {size(plan.bytes)}。</p><p className="text-sm">释放后，网站、其他设备以及引用这份素材的共享画布将无法继续预览或下载它。需要使用时，请从本地快照重新确认恢复。当前磁盘上的原文件保留。</p></>}
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} className="mt-1 size-4 shrink-0"/><span>{cleanup ? "我确认永久删除清单中的本地文件，删除后无法从本机恢复。" : "我已了解跨设备影响，确认保留本地原文件并释放云端副本。"}</span></label>
        <div className="flex flex-wrap gap-2"><button type="button" className="desktop-settings__command" disabled={busy || !accepted} onClick={() => void confirm()}>{cleanup ? "确认清理本地文件" : "确认释放云端副本"}</button><button type="button" className="desktop-settings__command" disabled={busy} onClick={() => { setCleanup(null); setRelease(null); setAccepted(false); }}>返回列表</button></div>
      </section> : <div className="max-h-[45vh] space-y-3 overflow-y-auto">
        {mode === "local" ? projects.map(project => <section key={project.id} className="space-y-2 rounded-lg border p-3"><strong className="block break-words text-sm">{project.name}</strong><p className="text-xs text-muted-foreground">{project.snapshots} 份快照 · 快照 {size(project.snapshotBytes)} · 引用素材 {size(project.mediaBytes)}（可能共用）</p><button type="button" className="desktop-settings__command" disabled={busy} onClick={() => void inspect(project.id)}>检查清理范围</button></section>) : copies.map(copy => <section key={copy.assetId} className="space-y-2 rounded-lg border p-3"><strong className="block break-words text-sm">{copy.name}</strong><p className="text-xs text-muted-foreground">本地文件 {size(copy.bytes)} · {copy.cloudState === "released" ? "云端副本已释放" : copy.cloudState === "pending" ? "上次释放待核对" : "点击后重新校验"}</p><button type="button" className="desktop-settings__command" disabled={busy || copy.cloudState === "released"} onClick={() => void inspect(copy.assetId)}>校验并检查释放影响</button></section>)}
        {!busy && !error && (mode === "local" ? !projects.length : !copies.length) && <p className="text-sm text-muted-foreground">{mode === "local" ? "当前账户没有可清理的本地工程快照。" : "没有可核对的本地素材副本，请先保存云端素材到本地。"}</p>}
      </div>}
      <button type="button" className="desktop-settings__command justify-center" disabled={busy} onClick={() => void load(mode)}>重新读取存储状态</button>
    </DialogContent></Dialog>
  </div>;
}
