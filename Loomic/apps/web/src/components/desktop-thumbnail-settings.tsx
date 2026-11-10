"use client";
import { useEffect, useState } from "react";
import { desktopStorageError, type DesktopStorageApi, type ThumbnailUsage } from "@/lib/desktop-storage";
import { StyledSelect } from "@/components/ui/styled-select";
const size = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
const reasons = { automatic: "自动淘汰", manual: "手动清理", settings: "调整容量" };
export function DesktopThumbnailSettings({ api, accountId, disabled }: { api: DesktopStorageApi; accountId: string; disabled: boolean }) {
  const [cache, setCache] = useState<ThumbnailUsage | null>(null), [capacity, setCapacity] = useState("128");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const update = (usage: ThumbnailUsage) => { setCache(usage); setCapacity(String(usage.limitBytes / 1024 ** 2)); };
  useEffect(() => {
    let active = true;
    void api.getThumbnailUsage?.(accountId).then(usage => { if (active) update(usage); }).catch(cause => { if (active) setError(desktopStorageError(cause)); });
    return () => { active = false; };
  }, [api, accountId]);
  const save = async () => {
    if (!api.configureThumbnailCache) return; setBusy(true); setError("");
    try { update(await api.configureThumbnailCache(accountId, { capacityMiB: Number(capacity) })); setNotice("容量设置已保存，超出上限的封面已清理，原文件保留。"); }
    catch (cause) { setError(desktopStorageError(cause)); } finally { setBusy(false); }
  };
  const clear = async () => {
    if (!api.clearThumbnailCache || !api.getThumbnailUsage) return; setBusy(true); setError("");
    try { const cleared = await api.clearThumbnailCache(accountId); update(await api.getThumbnailUsage(accountId)); setNotice(`已释放 ${size(cleared.bytes)} 预览缓存，原文件保留。`); }
    catch (cause) { setError(desktopStorageError(cause)); } finally { setBusy(false); }
  };
  return <section className="space-y-2 border-t pt-3 text-xs text-muted-foreground" aria-label="封面缓存设置">
    <h4 className="font-medium text-foreground">本地封面缓存</h4>
    {cache ? <p>当前账户 {size(cache.bytes)} · {cache.files} 张；整个工作区 {size(cache.workspaceBytes)} / {size(cache.limitBytes)}。{cache.enabled === false ? "封面缓存已关闭，仍可打开原文件。" : `最多 ${cache.limitFiles} 张，${cache.retentionDays} 天未使用后淘汰。`}</p> : !error && <p>正在读取缓存状态…</p>}
    <p>容量适用于此工作区的所有账户。在读取、生成封面和打开缓存设置时检查并清理；不在后台持续扫描，图片与视频原文件不受影响。</p>
    {api.configureThumbnailCache && <div className="flex flex-wrap items-center gap-2"><StyledSelect aria-label="封面缓存容量" value={capacity} onChange={setCapacity} disabled={disabled || busy || !cache && !error} options={[0, 16, 32, 64, 128, 256, 512, 1024].map(value => ({ value: String(value), label: value ? `${value} MiB` : "关闭封面缓存" }))}/><button type="button" className="desktop-settings__command" disabled={disabled || busy || !cache && !error} onClick={save}>保存缓存设置</button></div>}
    {cache?.lastCleanup && <p>上次{reasons[cache.lastCleanup.reason]}：{new Date(cache.lastCleanup.at).toLocaleString()} · {cache.lastCleanup.files} 张 · {size(cache.lastCleanup.bytes)}</p>}
    <button type="button" className="desktop-settings__command" disabled={disabled || busy} onClick={clear}>清理我的预览缓存</button>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="text-destructive">{error}</p>}
  </section>;
}
