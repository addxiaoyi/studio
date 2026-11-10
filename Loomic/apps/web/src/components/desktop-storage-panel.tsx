"use client";

import { useEffect, useState } from "react";
import { FolderOpen, RefreshCw, Settings2, Square } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { desktopStorage, desktopStorageError, type CloudBackupState, type DesktopSetupState } from "@/lib/desktop-storage";
import { DesktopProjectRestore } from "./desktop-project-restore";

function useLocalBackup() {
  const { session } = useAuth();
  const api = desktopStorage();
  const [setup, setSetup] = useState<DesktopSetupState | null>(null);
  const [backup, setBackup] = useState<CloudBackupState | null>(null);
  const [error, setError] = useState("");
  const account = session?.user?.id;
  useEffect(() => {
    if (!api) return;
    let mounted = true;
    void api.getDesktopSetup().then(value => { if (mounted) setSetup(value); }).catch(cause => { if (mounted) setError(desktopStorageError(cause)); });
    if (account) void api.getCloudBackup(account).then(value => { if (mounted) setBackup(value); }).catch(cause => { if (mounted) setError(desktopStorageError(cause)); });
    const stop = api.onCloudBackup(value => { if (value.account === account) setBackup(value); });
    return () => { mounted = false; stop(); };
  }, [api, account]);
  return { api, session, setup, backup, error, setError };
}

export function DesktopStoragePanel() {
  const { api, session, setup, backup, error, setError } = useLocalBackup();
  if (!api) return null;
  const busy = backup?.status === "running";
  const act = async (action: () => Promise<unknown>) => { setError(""); try { await action(); } catch (cause) { setError(desktopStorageError(cause)); } };
  const save = () => { if (session?.user?.id) void act(() => api.runCloudBackup({ accountId: session.user.id, accessToken: session.access_token })); };
  const configure = () => void act(api.openDesktopSetup);
  const openFolder = () => void act(api.openDesktopWorkspaceFolder);
  const cancel = () => void act(api.cancelCloudBackup);
  const failures = backup?.items.filter(item => item.state === "failed") ?? [];
  return <section className="desktop-settings__section" aria-labelledby="desktop-local-workspace">
    <div className="desktop-settings__section-heading"><h2 id="desktop-local-workspace">本地工作区与云端副本</h2><p>素材原文件和画布快照保存在本机，云端到期不会删除本地副本。</p></div>
    <div className="desktop-settings__row"><div className="min-w-0"><strong className="break-all">{setup?.root ?? "尚未配置本地工作区"}</strong><p>{setup?.available ? `${setup.autoBackup ? "登录后自动保存" : "手动保存"} · ${setup.agentAccess ? "Agent 目录授权已记住" : "未授予 Agent 目录访问"}` : setup?.error ?? "请选择可写入的本地目录"}</p></div>
      <button className="desktop-settings__command" onClick={configure} disabled={busy}><Settings2 aria-hidden="true"/>配置工作区</button></div>
    <div className="mt-3 flex flex-wrap gap-2">
      <button className="desktop-settings__command" onClick={save} disabled={busy || !session || !setup?.available}><RefreshCw aria-hidden="true"/>{backup?.status === "canceled" ? "继续保存" : backup?.status === "partial" || backup?.status === "failed" ? "重试未完成项" : "保存云端数据到本地"}</button>
      <button className="desktop-settings__command" onClick={openFolder} disabled={!setup?.available}><FolderOpen aria-hidden="true"/>打开工作区</button>
      {busy && <button className="desktop-settings__command" onClick={cancel}><Square aria-hidden="true"/>暂停保存</button>}
    </div>
    <p className="mt-3 text-xs leading-6 text-muted-foreground">Media 保存当前账户的图片与录像，Projects 保存画布、对话快照与校验记录，Exports 存放本机成片。暂停后的下载片段保留在工作区中，可继续保存；云端到期且没有本地副本的文件无法恢复。</p>
    <div role="status" className="mt-3 break-words text-sm" aria-live="polite">
      {busy ? <>正在保存：{backup.current || "读取云端列表…"}<br/>{(backup.bytes / 1024 ** 2).toFixed(1)} MiB{backup.totalBytes ? ` / ${(backup.totalBytes / 1024 ** 2).toFixed(1)} MiB` : ""}
        {typeof backup.bytesPerSecond === "number" && backup.bytesPerSecond > 0 && <span> · {(backup.bytesPerSecond / 1024 ** 2).toFixed(1)} MiB/s</span>}
        {backup.remainingSeconds != null && <span> · 预计剩余 {backup.remainingSeconds >= 60 ? `${Math.ceil(backup.remainingSeconds / 60)} 分钟` : `${backup.remainingSeconds} 秒`}</span>}
        {(backup.resumedBytes ?? 0) > 0 && <p className="text-xs text-muted-foreground">已从 {(backup.resumedBytes! / 1024 ** 2).toFixed(1)} MiB 继续下载</p>}
      </> : backup?.status === "completed" ? "本地副本已保存并通过校验" : backup?.error}
      {backup && backup.status !== "idle" && <p className="text-xs text-muted-foreground">本次保存 {backup.completed} 项 · 已校验跳过 {backup.skipped} 项 · 失败 {backup.failed} 项{backup.updatedAt ? ` · ${new Date(backup.updatedAt).toLocaleString()}` : ""}</p>}
    </div>
    {failures.length > 0 && <details className="mt-3 text-xs"><summary>查看 {failures.length} 项失败原因</summary><ul className="mt-2 space-y-2">{failures.slice(-20).map(item => <li key={item.key} className="break-words">{item.name}：{item.error}</li>)}</ul></details>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <DesktopProjectRestore api={api} accountId={session?.user?.id} accessToken={session?.access_token} disabled={busy || !setup?.available}/>
  </section>;
}

export function DesktopBackupBridge() {
  const { api, session, setup, backup, setError, error } = useLocalBackup();
  const account = session?.user?.id;
  const token = session?.access_token;
  useEffect(() => {
    if (!api || !account || !token || !setup?.autoBackup || !setup.available) return;
    let stopped = false;
    const run = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      try { const state = await api.getCloudBackup(account); if (state.status !== "running") await api.runCloudBackup({ accountId: account, accessToken: token }); }
      catch (cause) { if (!stopped) setError(desktopStorageError(cause)); }
    };
    const first = setTimeout(() => void run(), 4000);
    const interval = setInterval(() => void run(), 15 * 60_000);
    return () => { stopped = true; clearTimeout(first); clearInterval(interval); void api.cancelCloudBackup().catch(() => undefined); };
  }, [api, account, token, setup?.autoBackup, setup?.available, setError]);
  if (!api || !session || (!error && backup?.status !== "running" && backup?.status !== "partial" && backup?.status !== "failed")) return null;
  const cancel = () => { void api.cancelCloudBackup().catch(cause => setError(desktopStorageError(cause))); };
  return <aside aria-label="本地保存状态" className="fixed bottom-4 left-4 z-[70] flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-xs shadow-lg">
    <span role="status" className="max-w-64 truncate">{error || (backup?.status === "running" ? `正在保存到本地 · ${backup.current || "读取列表"}` : "部分云端数据尚未保存到本地")}</span>
    <a className="underline underline-offset-4" href="/desktop-app/settings/">查看进度</a>
    {backup?.status === "running" && <button type="button" onClick={cancel} className="min-h-8 px-2">停止</button>}
  </aside>;
}
