"use client";
import { useState } from "react";
import { desktopStorageError, type DesktopStorageApi } from "@/lib/desktop-storage";

export function DesktopSnapshotMedia({ api, snapshotId, accountId, media }: { api: DesktopStorageApi; snapshotId: string; accountId: string; media: Array<{ assetId: string; name: string }> }) {
  const [selected, setSelected] = useState<{ name: string; mime: string; bytes: number; url: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [limit, setLimit] = useState(20);
  if (!api.previewSnapshotMedia || !media.length) return null;
  const preview = async (assetId: string) => {
    setBusy(true); setError(""); setSelected(null);
    try { setSelected(await api.previewSnapshotMedia!(snapshotId, accountId, assetId)); }
    catch (cause) { setError(desktopStorageError(cause)); }
    finally { setBusy(false); }
  };
  const failed = () => { setSelected(null); setError("本地素材暂不能播放或预览已失效，请重新打开。原文件仍在工作区。"); };
  return <section aria-label="本地素材预览" className="space-y-3 border-t pt-3">
    <h3 className="text-sm font-medium">图片与视频原文件</h3>
    <p className="text-xs text-muted-foreground">点击后在本机校验并预览，不上传素材。视频支持拖动播放进度。</p>
    <div className="flex flex-wrap gap-2">{media.slice(0, limit).map(item => <button key={item.assetId} type="button" disabled={busy} className="desktop-settings__command" onClick={() => void preview(item.assetId)}>{item.name}</button>)}{media.length > limit && <button type="button" className="desktop-settings__command" onClick={() => setLimit(value => value + 20)}>显示更多素材</button>}</div>
    {busy && <p role="status" className="text-sm">正在校验本地原文件…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {selected && <figure className="space-y-2"><figcaption className="break-all text-xs text-muted-foreground">{selected.name} · {(selected.bytes / 1024 ** 2).toFixed(1)} MiB</figcaption>
      {selected.mime.startsWith("image/") ? <img src={selected.url} alt={selected.name} className="max-h-72 w-full rounded-lg object-contain" onError={failed}/> : selected.mime.startsWith("video/") ? <video src={selected.url} controls playsInline preload="metadata" aria-label={selected.name} className="max-h-72 w-full rounded-lg bg-black" onError={failed}/> : <audio src={selected.url} controls preload="metadata" aria-label={selected.name} onError={failed} className="w-full"/>}
    </figure>}
  </section>;
}
