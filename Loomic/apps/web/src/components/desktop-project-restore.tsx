"use client";
import { useEffect, useState } from "react";
import { FolderInput } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { desktopStorageError, type DesktopStorageApi, type LocalRestorePreview, type LocalRestoreResult, type RestoreProgress } from "@/lib/desktop-storage";
import { DesktopSnapshotBrowser } from "./desktop-snapshot-browser";
import { DesktopRestoreTasks } from "./desktop-restore-tasks";

export function DesktopProjectRestore({ api, accountId, accessToken, disabled }: { api: DesktopStorageApi; accountId: string | undefined; accessToken: string | undefined; disabled: boolean }) {
  const [preview, setPreview] = useState<LocalRestorePreview | null>(null);
  const [restored, setRestored] = useState<LocalRestoreResult | null>(null);
  const [busy, setBusy] = useState(false), [accepted, setAccepted] = useState(false), [error, setError] = useState("");
  const [progress, setProgress] = useState<RestoreProgress | null>(null);
  useEffect(() => api.onProjectRestore?.(setProgress), [api]);
  if (!api.inspectLocalProject || !api.restoreLocalProject) return null;
  const choose = async (snapshotId?: string) => {
    if (!accountId || !accessToken) return;
    setBusy(true); setError(""); setRestored(null); setAccepted(false); setProgress(null);
    try { setPreview(snapshotId && api.previewLocalSnapshot ? await api.previewLocalSnapshot(snapshotId, { accountId, accessToken }) : await api.inspectLocalProject!({ accountId, accessToken })); }
    catch (cause) { setError(desktopStorageError(cause)); }
    finally { setBusy(false); }
  };
  const restore = async () => {
    if (!preview || !accepted || !accountId || !accessToken) return;
    setBusy(true); setError("");
    try { setRestored(await api.restoreLocalProject!(preview.id, { accountId, accessToken })); }
    catch (cause) { setError(desktopStorageError(cause)); }
    finally { setBusy(false); }
  };
  const close = (open: boolean) => { if (!open && !busy) { setPreview(null); setError(""); } };
  const chooseFile = () => void choose();
  const chooseSnapshot = (id: string) => void choose(id);
  const resumeTask = async (id: string) => {
    if (!accountId || !accessToken || !api.previewRestoreTask) return;
    setBusy(true); setError(""); setRestored(null); setAccepted(false); setProgress(null);
    try { setPreview(await api.previewRestoreTask(id, { accountId, accessToken })); }
    catch (cause) { setError(desktopStorageError(cause)); }
    finally { setBusy(false); }
  };
  const openOffline = () => { void api.openOfflineSnapshots?.().catch(cause => setError(desktopStorageError(cause))); };
  const pause = () => { void api.cancelProjectRestore?.().catch(cause => setError(desktopStorageError(cause))); };
  const canvasUrl = restored ? `/desktop-app/canvas/?id=${encodeURIComponent(restored.canvasId)}${restored.sessionId ? `&session=${encodeURIComponent(restored.sessionId)}` : ""}&fitContent=1` : "";
  return <div className="mt-4">
    <div className="flex flex-wrap gap-2"><DesktopSnapshotBrowser api={api} accountId={accountId} accessToken={accessToken} disabled={disabled || busy} onPreview={chooseSnapshot}/><button type="button" className="desktop-settings__command" onClick={chooseFile} disabled={disabled || busy || !accountId}><FolderInput aria-hidden="true"/>{busy && !preview ? "正在读取快照…" : "从本地快照恢复工程"}</button></div>
    <div className="mt-2 flex flex-wrap gap-2"><DesktopRestoreTasks api={api} accountId={accountId} accessToken={accessToken} disabled={disabled || busy} onResume={id => void resumeTask(id)}/>{api.openOfflineSnapshots && <button type="button" className="desktop-settings__command" onClick={openOffline} disabled={busy}>打开离线快照库</button>}</div>
    {!preview && error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    <Dialog open={Boolean(preview)} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{restored ? "工程已恢复" : "恢复到新画布"}</DialogTitle><DialogDescription>创建新的工程和历史对话，保留现有工程。历史工具操作不会重新执行，也不会触发模型计费。</DialogDescription></DialogHeader>
        {preview && <div className="space-y-3 break-words"><strong className="block">{preview.name}</strong><p className="text-xs text-muted-foreground break-all">{preview.fileName}</p>
          <p>{preview.elements} 个画布元素 · {preview.sessions} 个对话 · {preview.messages} 条消息</p>
          <p className="text-sm text-muted-foreground">将上传 {preview.localMedia} 个本地素材副本（{(preview.uploadBytes / 1024 ** 2).toFixed(1)} MiB）到当前账户私有素材库。</p>
          {(preview.reusedMedia ?? 0) > 0 && <p className="text-sm text-muted-foreground">{preview.reusedMedia} 个素材将直接复用现有云端文件，不重复上传。</p>}
          {preview.missingMedia > 0 && <p role="alert" className="text-destructive">{preview.missingMedia} 个素材在本地和云端均不可用。请补齐素材后重新选择快照。</p>}
          {!restored && <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 size-4 shrink-0" checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={busy}/><span>我确认将这份快照和所列素材恢复到当前登录账户。</span></label>}
          {error && <p role="alert" className="text-destructive">{error}</p>}
          {busy && progress && <div role="status" aria-live="polite" className="space-y-2 rounded-lg bg-muted p-3 text-sm"><p className="break-all">{progress.phase === "restoring" ? "正在恢复画布与对话…" : `正在上传：${progress.name}`}</p><progress aria-label="素材上传进度" value={progress.bytes} max={Math.max(1, progress.totalBytes)} className="h-2 w-full accent-current"/><p className="tabular-nums">{(progress.bytes / 1024 ** 2).toFixed(1)} / {(progress.totalBytes / 1024 ** 2).toFixed(1)} MiB{progress.bytesPerSecond > 0 ? ` · ${(progress.bytesPerSecond / 1024 ** 2).toFixed(1)} MiB/s` : ""}{progress.remainingSeconds !== null ? ` · 预计剩余 ${progress.remainingSeconds} 秒` : ""}</p>{progress.resumedBytes > 0 && <p>已从 {(progress.resumedBytes / 1024 ** 2).toFixed(1)} MiB 继续上传</p>}{progress.phase === "uploading" && api.cancelProjectRestore && <button type="button" className="desktop-settings__command" onClick={pause}>暂停上传</button>}</div>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="desktop-settings__command" onClick={() => close(false)} disabled={busy}>{restored ? "关闭" : "取消"}</button>
            {restored ? <a className="desktop-settings__command" href={canvasUrl}>打开恢复的画布</a> : <button type="button" className="desktop-settings__command" onClick={restore} disabled={busy || !accepted || preview.missingMedia > 0}>{busy ? "正在恢复，请稍候…" : error ? "重试恢复" : "确认恢复"}</button>}
          </div>
        </div>}
      </DialogContent>
    </Dialog>
  </div>;
}
