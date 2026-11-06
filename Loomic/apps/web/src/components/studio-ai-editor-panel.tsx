"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { completeStudioPlan, confirmStudioPlan, requestStudioAiPlan, type StudioAiPlan } from "@/lib/studio-ai-edit";
import { desktopVideoBridge, exportStudioCut, recoverDesktopExport } from "@/lib/studio-desktop-export";
import { studioVideoDuration } from "@/lib/studio-video-metadata";
import type { StudioRuntime } from "@/lib/visualforge-runtime";
import { saveStudioPlan, type StudioExport } from "@/lib/visualforge-storage";
import { readRecoveredStudioSession, type StudioAiSession } from "@/lib/studio-ai-session";
import type { VideoEditorPlanRequest, VideoEditorExportReceipt } from "@helstera/shared";
import { useVideoText } from "@/lib/video-copy";

type Props = { runtime: StudioRuntime | null; mediaRevision: number; userId: string; token: string; exported(output: StudioExport): void };

export function StudioAiEditorPanel({ runtime, mediaRevision, userId, token, exported }: Props) {
  const copy = useVideoText();
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<StudioAiPlan | null>(null);
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const [receiptPending, setReceiptPending] = useState(false);
  const [exportedOnce, setExportedOnce] = useState(false);
  const [exportReceipt, setExportReceipt] = useState<VideoEditorExportReceipt>();
  const [music, setMusic] = useState("");
  const [volume, setVolume] = useState(30);
  const [musicStart, setMusicStart] = useState(0);
  const [restoring, setRestoring] = useState(true);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function restoreSession(session: StudioAiSession | null, active: () => boolean) {
    if (!active() || !session) return;
    setPlan(session.plan);
    setApplied(session.appliedRevision ?? null);
    setExportedOnce(Boolean(session.exportedOnce));
    setExportReceipt(session.exportReceipt);
    if (!session.appliedRevision) return;
    setConfirmed(new Set(session.plan.actions.map((_, index) => index)));
    setReceiptPending(!session.receiptSynced);
    if (session.receiptSynced) return;
    await completeStudioPlan(token, session.plan, session.exportReceipt);
    await saveStudioPlan(userId, { ...session, receiptSynced: true });
    if (active()) { setReceiptPending(false); setNotice("已恢复编辑记录并补回服务端回执，未重复修改时间线。"); }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: recovery runs once per connected editor and authenticated user, never on local action-state changes.
  useEffect(() => {
    if (!runtime) return;
    let active = true;
    setRestoring(true);
    void readRecoveredStudioSession(userId, runtime)
      .then(session => restoreSession(session, () => active))
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "编辑记录恢复失败，请重试。"); })
      .finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, [runtime, userId, token]);
  const audio = runtime?.listMedia().filter(item => item.mimeType.startsWith("audio/")) ?? [];

  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError("");
    try { await work(); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "视频编辑失败，请重试。"); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  async function previewPlan() {
    if (!runtime) return;
    await run(async () => {
      setPlan(null); setApplied(null); setReceiptPending(false); setExportedOnce(false); setExportReceipt(undefined); setNotice(""); setConfirmed(new Set());
      const snapshot = await runtime.snapshot();
      const media: VideoEditorPlanRequest["media"] = [];
      for (const item of runtime.listMedia()) {
        const duration = await studioVideoDuration(await runtime.readMedia(item.name));
        media.push({ name: item.name, mimeType: item.mimeType as VideoEditorPlanRequest["media"][number]["mimeType"], duration });
      }
      const next = await requestStudioAiPlan(token, { prompt, projectId: runtime.projectId(), compositionId: snapshot.compositionId, revision: snapshot.revision, compositionDuration: snapshot.duration, captions: snapshot.captions, media,
        ...(music ? { music: { assetName: music, volume: volume / 100, startMs: Math.round(musicStart * 1000) } } : {}) }, snapshot);
      await saveStudioPlan(userId, { plan: next });
      if (mounted.current) setPlan(next);
    });
  }

  function toggleAction(event: React.ChangeEvent<HTMLInputElement>) {
    const index = Number(event.currentTarget.value);
    const checked = event.currentTarget.checked;
    setConfirmed(current => { const next = new Set(current); if (checked) next.add(index); else next.delete(index); return next; });
  }

  async function applyPlan() {
    if (!runtime || !plan || applied) return;
    await run(async () => {
      const snapshot = await runtime.snapshot();
      if (snapshot.compositionId !== plan.snapshot?.compositionId || snapshot.revision !== plan.snapshot.revision) throw new Error("当前合成或素材已改变，请重新生成计划。");
      const edit = await confirmStudioPlan(token, plan, confirmed);
      if (plan.actions.some(action => action.type !== "export")) await runtime.applyEdit(edit);
      const saved = await runtime.snapshot();
      setApplied(saved.revision);
      setNotice(plan.exportFormat ? "剪辑已保存在当前合成，导出尚未执行。" : "计划已应用并保存在当前合成，可使用撤销恢复。");
      setReceiptPending(true);
      await saveStudioPlan(userId, { plan, appliedRevision: saved.revision, receiptSynced: false });
      await completeStudioPlan(token, plan);
      await saveStudioPlan(userId, { plan, appliedRevision: saved.revision, receiptSynced: true });
      setReceiptPending(false);
    });
  }

  async function retryReceipt() {
    if (!plan) return;
    await run(async () => { await completeStudioPlan(token, plan, exportReceipt); await saveStudioPlan(userId, { plan, appliedRevision: applied, receiptSynced: true, exportedOnce, exportReceipt }); setReceiptPending(false); setNotice("服务端已收到回执，未重复修改时间线或导出。"); });
  }

  async function exportPlan() {
    if (!runtime || !plan || !applied || exportedOnce) return;
    await run(async () => {
      const snapshot = await runtime.snapshot();
      if (snapshot.revision !== applied || snapshot.compositionId !== plan.snapshot?.compositionId) throw new Error("合成已改变，请重新预览导出计划。");
      if (!snapshot.cut) throw new Error("当前合成包含自由编辑内容，请使用编辑器“渲染”导出完整画面；本机快剪导出只适用于仍与已确认计划一致的时间线。");
      const bridge = desktopVideoBridge();
      if (!bridge) throw new Error("请在桌面客户端执行本机 FFmpeg 导出，或使用编辑器的渲染功能。");
      const saved = await exportStudioCut(runtime, snapshot.cut);
      if (!saved) { setNotice("已取消导出，没有生成文件。"); return; }
      setExportedOnce(true);
      setNotice(`成片已保存：${saved.path}`);
      const name = saved.path.split(/[\\/]/).pop();
      if (!saved.previewId || !name) {
        await saveStudioPlan(userId, { plan, appliedRevision: applied, receiptSynced: true, exportedOnce: true });
        throw new Error("成片已保存，但预览未登记。请从本地素材目录打开，勿重复导出。");
      }
      const receipt = { previewId: saved.previewId, name };
      setExportReceipt(receipt);
      setReceiptPending(true);
      await saveStudioPlan(userId, { plan, appliedRevision: applied, receiptSynced: false, exportedOnce: true, exportReceipt: receipt });
      const entry = (await bridge.listExportPreviews()).find(item => item.id === saved.previewId);
      if (!entry) throw new Error("成片已保存，但预览记录尚不可用。请从本地素材目录恢复。");
      exported(await recoverDesktopExport(userId, entry));
      await completeStudioPlan(token, plan, receipt);
      await saveStudioPlan(userId, { plan, appliedRevision: applied, receiptSynced: true, exportedOnce: true, exportReceipt: receipt });
      setReceiptPending(false);
    });
  }

  return <aside aria-label={copy("AI 编辑当前合成")} className="flex min-h-0 w-full shrink-0 flex-col bg-card text-card-foreground">
    <div className="border-b px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><Bot className="size-4" aria-hidden="true" />{copy("AI 编辑当前合成")}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{copy("模型生成计划，逐项确认后修改当前时间线。")}</p></div>
    <div className="space-y-3 overflow-y-auto p-4">
      <textarea aria-label={copy("描述视频编辑目标")} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={copy("例如：剪成 30 秒竖屏视频，加标题字幕和已导入的音乐")} rows={4} disabled={!runtime || busy} className="w-full resize-y rounded-lg border bg-background p-3 text-base sm:text-sm" />
      <label className="block space-y-1 text-xs">{copy("背景音乐素材")}<select aria-label={copy("背景音乐素材")} className="w-full rounded border bg-background p-2 text-base sm:text-sm" value={music} onChange={event => setMusic(event.target.value)} disabled={busy || !audio.length}><option value="">{copy("由计划选择现有素材")}</option>{audio.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
      <label className="block text-xs">{copy("音乐音量")} {volume}%<input aria-label={copy("音乐音量")} type="range" min={0} max={100} value={volume} onChange={event => setVolume(Number(event.target.value))} disabled={busy} className="w-full" /></label>
      <label className="block space-y-1 text-xs">{copy("音乐起播（秒）")}<input aria-label={copy("音乐起播（秒）")} type="number" min={0} max={7200} step={0.1} value={musicStart} onChange={event => setMusicStart(Number(event.target.value))} disabled={busy || !music} className="w-full rounded border bg-background p-2 text-base sm:text-sm" /></label>
      {!audio.length && <p className="text-xs text-muted-foreground">{copy("导入 MP3、WAV、OGG 或 M4A 后可选配乐。使用已有素材：0 积分。")}</p>}
      <Button className="w-full" variant="outline" disabled={!runtime || !prompt.trim() || busy || restoring || receiptPending} onClick={previewPlan}><Sparkles className="size-4" aria-hidden="true" />{copy(restoring ? "正在恢复编辑记录…" : busy ? "正在处理…" : "生成 AI 编辑计划")}</Button>
      {!runtime && <p className="text-xs text-muted-foreground">{copy("正在等待编辑器连接。")}</p>}
      {plan && <div className="space-y-3 rounded-lg border bg-background p-3" data-testid="studio-ai-plan">
        <h3 className="text-xs font-semibold">{copy("计划预览 · 模型生成")}</h3><p className="text-xs leading-5 text-muted-foreground">{plan.summary}</p>
        <ol className="space-y-2 text-xs">{plan.actions.map((action, index) => <li key={`${action.type}:${action.label}`}><label className="flex items-start gap-2"><input type="checkbox" value={index} checked={confirmed.has(index)} onChange={toggleAction} disabled={busy || Boolean(applied)} /><span className="min-w-0 break-words">{action.label}</span></label></li>)}</ol>
        {plan.notices.map(item => <p key={item} className="text-xs leading-5 text-muted-foreground">{item}</p>)}
        <Button className="w-full" disabled={busy || Boolean(applied) || confirmed.size !== plan.actions.length} onClick={applyPlan}>{copy(applied ? "已应用到当前合成" : "确认并修改当前合成")}</Button>
        {receiptPending && <Button className="w-full" variant="outline" disabled={busy} onClick={retryReceipt}>{copy("重试同步回执")}</Button>}
        {plan.exportFormat && <Button className="w-full" variant="outline" disabled={busy || !applied || exportedOnce || receiptPending} onClick={exportPlan}>{copy(exportedOnce ? "成片已保存" : "导出已确认的合成")}</Button>}
      </div>}
      {notice && <output aria-live="polite" className="block break-words text-xs leading-5 text-emerald-700 dark:text-emerald-300">{copy(notice)}</output>}
      {error && <p role="alert" className="text-xs leading-5 text-destructive">{copy(error)}</p>}
      <span className="sr-only">{copy("素材列表版本")} {mediaRevision}</span>
    </div>
  </aside>;
}
