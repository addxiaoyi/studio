"use client";
import { useEffect, useState } from "react";
import { desktopStorageError, type DesktopStorageApi } from "@/lib/desktop-storage";
import { StyledSelect } from "./ui/styled-select";
export function DesktopScanRate({ api }: { api: DesktopStorageApi }) {
  const [rate, setRate] = useState("32"), [busy, setBusy] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void api.getWorkspaceScanSettings?.().then(value => { if (active) setRate(String(value.rateMiB)); }).catch(cause => { if (active) setError(desktopStorageError(cause)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api]);
  if (!api.configureWorkspaceScan) return null;
  const save = async () => {
    setBusy(true); setError("");
    try { const saved = await api.configureWorkspaceScan!({ rateMiB: Number(rate) }); setRate(String(saved.rateMiB)); setNotice("读取速度已保存，当前扫描也会使用新上限。"); }
    catch (cause) { setError(desktopStorageError(cause)); } finally { setBusy(false); }
  };
  return <div className="space-y-2 text-xs"><p className="text-muted-foreground">扫描默认限制为 32 MiB/s；剪辑或播放时可降到 8 MiB/s，暂停会立即释放读取任务。</p><div className="flex flex-wrap items-center gap-2"><StyledSelect aria-label="扫描读取速度上限" value={rate} onChange={setRate} disabled={busy} options={[8, 16, 32, 64, 128, 0].map(value => ({ value: String(value), label: value ? `${value} MiB/s` : "不限速" }))}/><button type="button" className="desktop-settings__command" disabled={busy} onClick={save}>保存扫描速度</button></div>{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="text-destructive">{error}</p>}</div>;
}
