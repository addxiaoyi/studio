"use client";
import { useState } from "react";
import { desktopStorageError, type DesktopStorageApi, type ThumbnailUsage, type WorkspaceUsageReport } from "@/lib/desktop-storage";
const labels: Record<string, string> = { media: "素材原文件", projects: "工程与对话快照", exports: "导出成片", cache: "预览缓存", other: "其他文件" };
const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;

export function DesktopDiskUsage({ api, accountId }: { api: DesktopStorageApi; accountId: string }) {
  const [report, setReport] = useState<WorkspaceUsageReport | null>(null), [cache, setCache] = useState<ThumbnailUsage | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  if (!api.getWorkspaceUsage) return null;
  const scan = async (duplicates: boolean) => {
    setBusy(true); setError(""); setNotice("");
    try { setReport(await api.getWorkspaceUsage!(accountId, duplicates)); if (api.getThumbnailUsage) setCache(await api.getThumbnailUsage(accountId)); }
    catch (cause) { setError(desktopStorageError(cause)); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    if (!api.clearThumbnailCache) return; setBusy(true); setError("");
    try { const cleared = await api.clearThumbnailCache(accountId); setNotice(`已释放 ${size(cleared.bytes)} 预览缓存，原文件保留。`); setCache(await api.getThumbnailUsage!(accountId)); setReport(null); }
    catch (cause) { setError(desktopStorageError(cause)); }
    finally { setBusy(false); }
  };
  const locate = (id: string) => { void api.revealWorkspaceFile?.(id).catch(cause => setError(desktopStorageError(cause))); };
  const stop = () => { void api.cancelWorkspaceScan?.().catch(cause => setError(desktopStorageError(cause))); };
  return <section className="space-y-3 rounded-lg border p-3" aria-label="本地磁盘分析">
    <h3 className="text-sm font-medium">磁盘占用与重复素材</h3>
    <p className="text-xs text-muted-foreground">分类覆盖整个工作区；重复内容只检查当前账户素材与成片，按文件内容验证。共用素材可能被多个工程引用，不会自动删除。</p>
    <div className="flex flex-wrap gap-2"><button type="button" className="desktop-settings__command" disabled={busy} onClick={() => void scan(false)}>统计磁盘分类</button><button type="button" className="desktop-settings__command" disabled={busy} onClick={() => void scan(true)}>校验重复素材</button>{busy && <button type="button" className="desktop-settings__command" onClick={stop}>停止扫描</button>}</div>
    {busy && <p role="status" className="text-sm">正在读取本地磁盘，大文件校验可能需要一些时间…</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
    {report && <><dl className="space-y-2 text-sm">{report.categories.map(row => <div key={row.id} className="flex flex-wrap justify-between gap-2"><dt>{labels[row.id] ?? row.id}</dt><dd>{size(row.bytes)} · {row.files} 个文件</dd></div>)}</dl>
      <p className="text-xs text-muted-foreground">合计 {size(report.totalBytes)} · 已核对重复内容 {size(report.hashedBytes)}。分类按文件长度统计，硬链接可能共用磁盘块。</p>
      {report.truncated && <p role="status" className="text-xs">本次达到扫描上限，结果不包含全部文件；可整理工作区后再次扫描。</p>}
      {report.duplicateGroups > 0 ? <><p className="text-sm">发现 {report.duplicateGroups} 组相同内容，额外副本约 {size(report.duplicateBytes)}。</p>{report.duplicates.map((group, index) => <details key={index} className="text-sm"><summary>{group.files.length} 个相同文件 · 额外 {size(group.extraBytes)}</summary><ul className="mt-2 space-y-2 text-xs">{group.files.map(file => <li key={file.id} className="break-all">{file.relativePath}<button type="button" className="ml-2 min-h-9 underline" onClick={() => locate(file.id)}>定位文件</button></li>)}</ul></details>)}</> : <p className="text-xs text-muted-foreground">当前结果没有已验证的重复素材；“校验重复素材”会进一步比对文件内容。</p>}
      {report.warnings.length > 0 && <details className="text-xs"><summary>查看跳过的文件</summary>{report.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
    </>}
    {cache && <div className="space-y-2 border-t pt-3 text-xs text-muted-foreground"><p>当前账户缩略图 {size(cache.bytes)} · {cache.files} 张；整个工作区缓存 {size(cache.workspaceBytes)} / {size(cache.limitBytes)}，最多 {cache.limitFiles} 张，{cache.retentionDays} 天未使用后自动淘汰。</p><button type="button" className="desktop-settings__command" disabled={busy} onClick={() => void clear()}>清理我的预览缓存</button></div>}
  </section>;
}
