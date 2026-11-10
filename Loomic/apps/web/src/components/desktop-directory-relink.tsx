"use client";
import { useEffect, useState } from "react";
import { desktopStorageError, type DesktopStorageApi, type DirectoryRelinkPlan, type DirectoryRelinkResult } from "@/lib/desktop-storage";
import { StyledSelect } from "@/components/ui/styled-select";

const statusLabels = { matched: "内容一致", ambiguous: "多个相同文件，请选择位置", missing: "未找到匹配原文件", unchanged: "当前位置已验证", invalid: "缺少有效的原文件校验记录" };
export function DesktopDirectoryRelink({ api, accountId, disabled }: { api: DesktopStorageApi; accountId: string; disabled: boolean }) {
  const [plan, setPlan] = useState<DirectoryRelinkPlan | null>(null), [selected, setSelected] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"idle" | "scanning" | "applying" | "saving" | "loading">("idle"), [error, setError] = useState("");
  const [receipt, setReceipt] = useState<DirectoryRelinkResult | null>(null), [limit, setLimit] = useState(40);
  const restored = (saved: DirectoryRelinkPlan | null) => { setPlan(saved); setSelected(Object.fromEntries((saved?.selections ?? []).map(choice => [choice.assetId, choice.candidateId]))); setLimit(40); };
  useEffect(() => {
    if (!api.resumeRelinkDirectory) return;
    let active = true; setPhase("loading");
    void api.resumeRelinkDirectory(accountId).then(saved => { if (active) restored(saved); }).catch(cause => { if (active) setError(desktopStorageError(cause)); }).finally(() => { if (active) setPhase("idle"); });
    return () => { active = false; };
  }, [api, accountId]);
  if (!api.chooseRelinkDirectory) return null;
  const choose = async () => {
    setPhase("scanning"); setError(""); setPlan(null); setReceipt(null); setSelected({}); setLimit(40);
    try { restored(await api.chooseRelinkDirectory!(accountId)); }
    catch (cause) { setError(desktopStorageError(cause)); }
    finally { setPhase("idle"); }
  };
  const apply = async () => {
    if (!plan || !api.applyRelinkDirectory) return;
    setPhase("applying"); setError("");
    try { setReceipt(await api.applyRelinkDirectory(plan.id, Object.entries(selected).filter(([, candidate]) => candidate).map(([assetId, candidateId]) => ({ assetId, candidateId })))); restored(await api.resumeRelinkDirectory?.(accountId) ?? null); }
    catch (cause) { setError(desktopStorageError(cause)); }
    finally { setPhase("idle"); }
  };
  const select = async (assetId: string, candidateId: string) => {
    if (!plan) return;
    const next = { ...selected, [assetId]: candidateId }; setPhase("saving"); setError("");
    try { await api.saveRelinkSelection?.(plan.id, Object.entries(next).filter(([, value]) => value).map(([assetId, candidateId]) => ({ assetId, candidateId }))); setSelected(next); }
    catch (cause) { setError(desktopStorageError(cause)); } finally { setPhase("idle"); }
  };
  const discard = async () => {
    setPhase("saving"); setError("");
    try { await api.discardRelinkDirectory?.(accountId); restored(null); setReceipt(null); }
    catch (cause) { setError(desktopStorageError(cause)); } finally { setPhase("idle"); }
  };
  const cancel = () => { void api.cancelRelinkDirectory?.().catch(cause => setError(desktopStorageError(cause))); };
  const busy = disabled || phase !== "idle", count = Object.values(selected).filter(Boolean).length;
  return <section className="space-y-3 border-t pt-3" aria-label="整目录重新关联">
    <h4 className="text-sm font-medium">找回移动或改名后的素材</h4>
    <p className="text-xs text-muted-foreground">选择目录后按内容校验，逐项选择再确认。外部文件复制进当前工作区并保留源文件；已有素材只更新位置。不会上传到云端。</p>
    <button type="button" className="desktop-settings__command" disabled={busy} onClick={choose}>核对素材目录</button>
    {api.discardRelinkDirectory && <button type="button" className="desktop-settings__command" disabled={busy} onClick={discard}>清除已保存预览</button>}
    {phase === "loading" && <p role="status">正在读取本机保存的目录预览…</p>}
    {phase === "saving" && <p role="status">正在保存到本机…</p>}
    {phase === "scanning" && <><p role="status">正在核对目录与原文件内容…</p><button type="button" onClick={cancel} className="desktop-settings__command">取消目录核对</button></>}
    {phase === "applying" && <p role="status">正在逐项校验并关联，请等待完成后退出。</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {plan && <><p className="break-all text-xs">{plan.folder} · {plan.items.length} 项素材</p>{plan.savedAt && <p className="text-xs text-muted-foreground">预览及选择保留 7 天，可退出后继续。确认时重新校验文件；不会自动执行。保存于 {new Date(plan.savedAt).toLocaleString()}。</p>}
      {plan.items.length === 0 && <p className="text-sm">当前账户没有可重新关联的素材索引。</p>}
      <ul className="max-h-96 space-y-3 overflow-auto">{plan.items.slice(0, limit).map(item => <li key={item.assetId} className="space-y-1 rounded-md border p-2 text-xs">
        <p className="break-all font-medium">{item.name}</p><p>{statusLabels[item.status]}</p>
        {["matched", "ambiguous"].includes(item.status) && <StyledSelect aria-label={`匹配位置：${item.name}`} value={selected[item.assetId] ?? ""} disabled={busy} onChange={value => void select(item.assetId, value)} options={[{ value: "", label: "跳过此素材" }, ...item.candidates.map(candidate => ({ value: candidate.id, label: candidate.relativePath, note: candidate.willCopy ? "复制进工作区，保留源文件" : "仅更新位置" }))]}/>}
      </li>)}</ul>
      {limit < plan.items.length && <button type="button" className="desktop-settings__command" onClick={() => setLimit(limit + 40)}>显示更多匹配</button>}
      {plan.truncated && <p role="status" className="text-xs">目录或候选匹配达到上限，仅显示部分结果；请选择更小的子目录继续。</p>}
      {plan.warnings.length > 0 && <details className="text-xs"><summary>查看未能核对的文件</summary>{plan.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details>}
      <button type="button" className="desktop-settings__command" disabled={busy || !count} onClick={apply}>确认关联所选 {count} 项</button>
    </>}
    {receipt && <div role="status" className="space-y-2 text-xs"><p>已关联 {receipt.items.filter(item => item.ok).length} 项，失败 {receipt.items.filter(item => !item.ok).length} 项。</p>{receipt.items.filter(item => !item.ok).map(item => <p key={item.assetId}>{item.assetId}：{item.error}</p>)}<p>可重新核对目录重试失败项；已完成的关联会保留。</p></div>}
  </section>;
}
