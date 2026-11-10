"use client";
import { useState } from "react";
import { FolderInput } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { desktopStorageError, type DesktopStorageApi, type LocalRestorePreview, type LocalRestoreResult } from "@/lib/desktop-storage";

export function DesktopProjectRestore({ api, accountId, accessToken, disabled }: { api: DesktopStorageApi; accountId: string | undefined; accessToken: string | undefined; disabled: boolean }) {
  const [preview, setPreview] = useState<LocalRestorePreview | null>(null);
  const [restored, setRestored] = useState<LocalRestoreResult | null>(null);
  const [busy, setBusy] = useState(false), [accepted, setAccepted] = useState(false), [error, setError] = useState("");
  if (!api.inspectLocalProject || !api.restoreLocalProject) return null;
  const choose = async () => {
    if (!accountId || !accessToken) return;
    setBusy(true); setError(""); setRestored(null); setAccepted(false);
    try { setPreview(await api.inspectLocalProject!({ accountId, accessToken })); }
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
  const canvasUrl = restored ? `/desktop-app/canvas/?id=${encodeURIComponent(restored.canvasId)}${restored.sessionId ? `&session=${encodeURIComponent(restored.sessionId)}` : ""}&fitContent=1` : "";
  return <div className="mt-4">
    <button type="button" className="desktop-settings__command" onClick={choose} disabled={disabled || busy || !accountId}><FolderInput aria-hidden="true"/>{busy && !preview ? "正在读取快照…" : "从本地快照恢复工程"}</button>
    {!preview && error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    <Dialog open={Boolean(preview)} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{restored ? "工程已恢复" : "恢复到新画布"}</DialogTitle><DialogDescription>创建新的工程和历史对话，保留现有工程。历史工具操作不会重新执行，也不会触发模型计费。</DialogDescription></DialogHeader>
        {preview && <div className="space-y-3 break-words"><strong className="block">{preview.name}</strong><p className="text-xs text-muted-foreground break-all">{preview.fileName}</p>
          <p>{preview.elements} 个画布元素 · {preview.sessions} 个对话 · {preview.messages} 条消息</p>
          <p className="text-sm text-muted-foreground">将上传 {preview.localMedia} 个本地素材副本（{(preview.uploadBytes / 1024 ** 2).toFixed(1)} MiB）到当前账户私有素材库。</p>
          {preview.missingMedia > 0 && <p role="alert" className="text-destructive">{preview.missingMedia} 个素材在本地和云端均不可用。请补齐素材后重新选择快照。</p>}
          {!restored && <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 size-4 shrink-0" checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={busy}/><span>我确认将这份快照和所列素材恢复到当前登录账户。</span></label>}
          {error && <p role="alert" className="text-destructive">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="desktop-settings__command" onClick={() => close(false)} disabled={busy}>{restored ? "关闭" : "取消"}</button>
            {restored ? <a className="desktop-settings__command" href={canvasUrl}>打开恢复的画布</a> : <button type="button" className="desktop-settings__command" onClick={restore} disabled={busy || !accepted || preview.missingMedia > 0}>{busy ? "正在恢复，请稍候…" : error ? "重试恢复" : "确认恢复"}</button>}
          </div>
        </div>}
      </DialogContent>
    </Dialog>
  </div>;
}
