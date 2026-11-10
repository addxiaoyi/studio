"use client";
import { useEffect, useRef, useState } from "react";
import { desktopStorageError, type DesktopStorageApi, type RelinkPlan } from "@/lib/desktop-storage";

function useLocalThumbnail(api: DesktopStorageApi, snapshotId: string, accountId: string, assetId: string, revision: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    if (!api.getSnapshotThumbnail || !ref.current) return;
    let active = true, started = false;
    setUrl(""); setError("");
    const load = () => {
      if (started) return; started = true;
      void api.getSnapshotThumbnail!(snapshotId, accountId, assetId).then(file => { if (active) setUrl(file.url); }).catch(cause => { if (active) setError(desktopStorageError(cause)); });
    };
    if (typeof IntersectionObserver === "undefined") load();
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { load(); observer?.disconnect(); } }, { rootMargin: "80px" });
    observer?.observe(ref.current);
    return () => { active = false; observer?.disconnect(); };
  }, [api, snapshotId, accountId, assetId, revision]);
  return { ref, url, error };
}

export function DesktopMediaCard({ api, snapshotId, accountId, item, disabled, onPreview }: { api: DesktopStorageApi; snapshotId: string; accountId: string; item: { assetId: string; name: string }; disabled: boolean; onPreview: (assetId: string) => void }) {
  const [revision, setRevision] = useState(0), [plan, setPlan] = useState<RelinkPlan | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const thumbnail = useLocalThumbnail(api, snapshotId, accountId, item.assetId, revision);
  const choose = async () => {
    setBusy(true); setMessage("");
    try { setPlan(await api.chooseRelinkMedia!(accountId, item.assetId)); }
    catch (cause) { setMessage(desktopStorageError(cause)); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!plan) return; setBusy(true); setMessage("");
    try { const saved = await api.applyMediaRelink!(plan.id); setPlan(null); setRevision(value => value + 1); setMessage(`${saved.filename} 已关联并通过校验。`); }
    catch (cause) { setMessage(desktopStorageError(cause)); setPlan(null); }
    finally { setBusy(false); }
  };
  return <div ref={thumbnail.ref} className="min-w-0 space-y-2 rounded-lg border p-2">
    <button type="button" disabled={disabled || busy} onClick={() => onPreview(item.assetId)} className="w-full space-y-2 text-left" aria-label={`预览 ${item.name}`}>
      {thumbnail.url ? <img src={thumbnail.url} alt="本地素材缩略图" className="aspect-video w-full rounded-md bg-muted px-2 object-contain"/> : <span className="flex aspect-video items-center justify-center rounded-md bg-muted px-2 text-xs text-muted-foreground">{thumbnail.error ? "封面不可用，可打开原文件" : api.getSnapshotThumbnail ? "正在准备本地封面…" : "打开本地原文件"}</span>}
      <span className="block break-words text-sm">{item.name}</span>
    </button>
    {api.chooseRelinkMedia && api.applyMediaRelink && <button type="button" disabled={disabled || busy} onClick={() => void choose()} className="min-h-9 text-xs underline underline-offset-4">{busy ? "正在校验…" : "重新关联原文件"}</button>}
    {plan && <div className="space-y-2 rounded-md bg-muted p-2 text-xs"><p className="break-all">{plan.filename} 内容校验一致。{plan.willCopy ? "确认后复制进当前工作区，保留原文件。" : "确认后更新文件位置，不复制素材。"}</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void confirm()} className="min-h-9 underline">确认关联</button><button type="button" disabled={busy} onClick={() => setPlan(null)} className="min-h-9">取消</button></div></div>}
    {message && <p role="status" className="break-words text-xs">{message}</p>}
    {thumbnail.error && !plan && <details className="text-xs text-muted-foreground"><summary>封面状态</summary><p>{thumbnail.error}</p><button type="button" className="min-h-9 underline" onClick={() => setRevision(value => value + 1)}>重试封面</button></details>}
  </div>;
}
