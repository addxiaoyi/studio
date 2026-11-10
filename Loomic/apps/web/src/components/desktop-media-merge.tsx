"use client";
import { useState } from "react";
import { desktopStorageError, type DesktopStorageApi, type MediaMergePlan, type MediaMergeResult, type WorkspaceUsageReport } from "@/lib/desktop-storage";
import { StyledSelect } from "./ui/styled-select";
export function DesktopMediaMerge({ api, accountId, group, disabled, onComplete }: { api: DesktopStorageApi; accountId: string; group: WorkspaceUsageReport["duplicates"][number]; disabled: boolean; onComplete(receipt: MediaMergeResult): void }) {
  const files = group.files.filter(file => file.relativePath.startsWith(`Media/${accountId}/`));
  const [keep, setKeep] = useState(files[0]?.id ?? ""), [selected, setSelected] = useState<string[]>([]);
  const [plan, setPlan] = useState<MediaMergePlan | null>(null), [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!api.previewMediaMerge || files.length < 2) return null;
  const chooseKeep = (id: string) => { setKeep(id); setSelected(previous => previous.filter(source => source !== id)); setPlan(null); setAccepted(false); };
  const preview = async () => {
    setBusy(true); setError(""); setAccepted(false);
    try { setPlan(await api.previewMediaMerge!(accountId, keep, selected)); }
    catch (cause) { setError(desktopStorageError(cause)); } finally { setBusy(false); }
  };
  const merge = async () => {
    if (!plan || !accepted || !api.applyMediaMerge) return;
    setBusy(true); setError("");
    try { onComplete(await api.applyMediaMerge(plan.id, true)); setPlan(null); }
    catch (cause) { setError(desktopStorageError(cause)); setPlan(null); } finally { setBusy(false); }
  };
  return <section className="mt-3 space-y-3 rounded-md border p-3 text-xs" aria-label="重复素材合并">
    <p>保留所有文件路径和素材 ID，将选中副本改为共享同一份原文件内容。删除其中一个路径不会删除其他引用；直接修改共享原文件会影响全部引用。</p>
    <StyledSelect aria-label="保留原文件" value={keep} onChange={chooseKeep} disabled={disabled || busy} options={files.map(file => ({ value: file.id, label: file.relativePath }))}/>
    <fieldset disabled={disabled || busy} className="space-y-2"><legend className="mb-2">选择要合并的副本</legend>{files.filter(file => file.id !== keep).map(file => <label key={file.id} className="flex items-start gap-2"><input type="checkbox" className="mt-1 size-4 shrink-0" checked={selected.includes(file.id)} onChange={event => { setSelected(previous => event.target.checked ? [...previous, file.id] : previous.filter(id => id !== file.id)); setPlan(null); setAccepted(false); }}/><span className="break-all">{file.relativePath}</span></label>)}</fieldset>
    <button type="button" className="desktop-settings__command" disabled={disabled || busy || !selected.length} onClick={preview}>核对工程引用与合并范围</button>
    {busy && <p role="status">正在校验文件内容与工程引用…</p>}{error && <p role="alert" className="text-destructive">{error}</p>}
    {plan && <div className="space-y-2"><p>涉及 {plan.assets} 个素材 ID、{plan.projects.length} 个工程；{plan.files.length} 个副本，文件内容合计 {(plan.bytes / 1024 ** 2).toFixed(1)} MiB。实际释放空间由文件系统统计。</p><ul>{plan.projects.map(project => <li key={`${project.kind}:${project.id}`}>{project.kind === "video" ? "视频工程" : "画布工程"} · {project.name}</li>)}</ul><p className="break-all">共享原文件：{plan.keep}</p><label className="flex items-start gap-2"><input type="checkbox" className="mt-1 size-4 shrink-0" checked={accepted} disabled={disabled || busy} onChange={event => setAccepted(event.target.checked)}/><span>我已核对工程引用，确认共享原文件并释放选中副本的重复内容。</span></label><button type="button" className="desktop-settings__command" disabled={disabled || busy || !accepted} onClick={merge}>确认合并并释放重复内容</button></div>}
  </section>;
}
