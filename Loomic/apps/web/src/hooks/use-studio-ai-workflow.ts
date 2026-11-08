"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoEditorExportReceipt, VideoEditorPlanRequest } from "@helstera/shared";
import type { StudioRuntime, StudioSnapshot } from "@/lib/visualforge-runtime";
import { completeStudioPlan, confirmStudioPlan, requestStudioAiPlan, type StudioAiPlan } from "@/lib/studio-ai-edit";
import { studioContextPrompt, type StudioAiContext } from "@/lib/studio-ai-context";
import { readRecoveredStudioSession, type StudioAiSession } from "@/lib/studio-ai-session";
import { clearStudioPlan, saveStudioPlan, type StudioExport } from "@/lib/visualforge-storage";
import { desktopVideoBridge, exportStudioCut, recoverDesktopExport } from "@/lib/studio-desktop-export";
import { studioVideoDuration } from "@/lib/studio-video-metadata";
import { useLocale } from "@/lib/i18n";

export type StudioWorkflowProps = {
  runtime: StudioRuntime | null; mediaRevision: number; userId: string; token: string;
  exported(output: StudioExport): void; contextRequest?: StudioAiContext | null;
  active?: boolean; onBusyChange?: (busy: boolean) => void;
};

export function useStudioAiWorkflow({ runtime, mediaRevision, userId, token, exported, contextRequest, active = true, onBusyChange }: StudioWorkflowProps) {
  const english = useLocale() === "en-US";
  const [prompt, updatePrompt] = useState("");
  const [context, setContext] = useState<StudioAiContext | null>(null);
  const [target, setTarget] = useState<StudioSnapshot | null>(null);
  const [plan, setPlan] = useState<StudioAiPlan | null>(null);
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [undoneActions, setUndoneActions] = useState<number[]>([]);
  const [actionUndoAvailable, setActionUndoAvailable] = useState(false);
  const [completelyUndone, setCompletelyUndone] = useState(false);
  const [receiptPending, setReceiptPending] = useState(false);
  const pendingReceipt = useRef(receiptPending);pendingReceipt.current = receiptPending;
  const [exportedOnce, setExportedOnce] = useState(false);
  const [exportReceipt, setExportReceipt] = useState<VideoEditorExportReceipt>();
  const [music, updateMusic] = useState("");
  const [volume, updateVolume] = useState(30);
  const [musicStart, updateMusicStart] = useState(0);
  const [mediaVersion, setMediaVersion] = useState(0);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const currentTarget = useRef<string | null>(null);
  useEffect(() => { mounted.current = true;return () => { mounted.current = false;requestVersion.current += 1; }; }, []);
  useEffect(() => { onBusyChange?.(busy || receiptPending); }, [busy, receiptPending, onBusyChange]);

  const clearPreview = useCallback(() => {
    requestVersion.current += 1;
    setPlan(null);setConfirmed(new Set());setApplied(null);setCanUndo(false);setExportedOnce(false);setExportReceipt(undefined);setUndoneActions([]);setActionUndoAvailable(false);setCompletelyUndone(false);
  }, []);

  const refreshTarget = useCallback(async () => {
    if (!runtime) return;
    try {
      const selected = await runtime.snapshot();
      if (!mounted.current) return;
      if (currentTarget.current && currentTarget.current !== selected.compositionId) {
        if (!pendingReceipt.current) clearPreview();
        setContext(current => current?.compositionId === selected.compositionId ? current : null);
        setNotice(pendingReceipt.current ? "请先同步上一视频的修改记录，再继续编辑。" : "已切换视频，请为当前视频重新预览方案。");
      }
      currentTarget.current = selected.compositionId;setTarget(selected);setError("");
    } catch (cause) { if (mounted.current) { setTarget(null);setError(cause instanceof Error ? cause.message : "无法读取当前视频，请重新选择。"); } }
  }, [runtime, clearPreview]);

  useEffect(() => {
    if (!active || !runtime) return;
    void refreshTarget();
    const timer = setInterval(() => { if (runtime.projectId() !== currentTarget.current) void refreshTarget(); }, 1200);
    return () => clearInterval(timer);
  }, [active, runtime, refreshTarget, mediaRevision, mediaVersion]);

  useEffect(() => {
    if (!contextRequest || lock.current) return;
    setContext(contextRequest);setError("");setNotice("");
    if (contextRequest.comment) updatePrompt(current => current.trim() ? current : contextRequest.comment);
    void refreshTarget();promptRef.current?.focus({ preventScroll: true });
  }, [contextRequest, clearPreview, refreshTarget]);

  useEffect(() => {
    if (!runtime) return;
    let alive = true;
    const version = requestVersion.current;
    setRestoring(true);
    void readRecoveredStudioSession(userId, runtime).then(async session => {
      if (!alive || !session || version !== requestVersion.current) return;
      setPlan(session.plan);setApplied(session.appliedRevision ?? null);setExportedOnce(Boolean(session.exportedOnce));setExportReceipt(session.exportReceipt);
      setUndoneActions(session.undoneActions ?? []);setActionUndoAvailable(Boolean(session.actionUndoAvailable));setCanUndo(Boolean(session.actionUndoAvailable));setCompletelyUndone(Boolean(session.completelyUndone));
      if (!session.appliedRevision) return;
      setConfirmed(new Set(session.plan.actions.map((_, index) => index)));setReceiptPending(!session.receiptSynced);
      if (session.receiptSynced) return;
      await completeStudioPlan(token, session.plan, session.exportReceipt);
      await saveStudioPlan(userId, { ...session, receiptSynced: true });
      if (alive) { setReceiptPending(false);setNotice("已恢复修改记录，时间线未重复修改。"); }
    }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "编辑记录恢复失败，请重试。"); }).finally(() => { if (alive) setRestoring(false); });
    return () => { alive = false; };
  }, [runtime, userId, token]);

  function changeRequest() {
    requestVersion.current += 1;
    if (plan && !applied) {
      setPlan(null);setConfirmed(new Set());
      void clearStudioPlan(userId).catch(() => setError("旧方案清理失败，请刷新前保留当前要求。"));
    }
    setError("");
  }
  function setPrompt(value: string) { changeRequest();updatePrompt(value); }
  function setMusic(value: string) {
    changeRequest();updateMusic(value);
    if (value && !prompt.trim()) updatePrompt(english ? "Add the selected background music and keep the existing visuals." : "添加选中的背景音乐，保留当前画面。");
  }
  function setVolume(value: number) { changeRequest();updateVolume(value); }
  function setMusicStart(value: number) { changeRequest();updateMusicStart(value); }
  function removeContext() { changeRequest();setContext(null); }
  function addRequest(text: string) {
    const next = prompt.trim() ? `${prompt}\n${text}` : text;
    if (next.length > 4000) { setError("编辑要求已达到字数上限，请缩短后再添加。");return; }
    setPrompt(next);promptRef.current?.focus();
  }

  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;setBusy(true);setError("");
    try { await work(); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "视频编辑失败，请重试。"); }
    finally { lock.current = false;if (mounted.current) setBusy(false); }
  }

  async function previewPlan() {
    if (!runtime || !prompt.trim() || receiptPending) return;
    await run(async () => {
      clearPreview();setNotice("");
      const version = requestVersion.current;
      const snapshot = await runtime.snapshot();setTarget(snapshot);
      if (music && (!Number.isFinite(musicStart) || musicStart < 0 || musicStart >= snapshot.duration)) throw new Error("音乐起播时间必须在当前视频时长内。");
      const media: VideoEditorPlanRequest["media"] = [];
      for (const item of runtime.listMedia()) media.push({ name: item.name, mimeType: item.mimeType as VideoEditorPlanRequest["media"][number]["mimeType"], duration: await studioVideoDuration(await runtime.readMedia(item.name)) });
      const next = await requestStudioAiPlan(token, { prompt: studioContextPrompt(prompt, context, snapshot.compositionId), projectId: runtime.projectId(), compositionId: snapshot.compositionId, revision: snapshot.revision, compositionDuration: snapshot.duration, captions: snapshot.captions, media,
        ...(music ? { music: { assetName: music, volume: volume / 100, startMs: Math.round(musicStart * 1000) } } : {}) }, snapshot);
      if (!mounted.current || version !== requestVersion.current || runtime.projectId() !== snapshot.compositionId) return;
      if (!music && next.actions.some(action => action.type === "audio")) throw new Error("方案包含未选择的音乐，请先选择配乐后重新预览。");
      await saveStudioPlan(userId, { plan: next });
      if (mounted.current && version === requestVersion.current) setPlan(next);
    });
  }

  async function discardPlan() { await run(async () => { await clearStudioPlan(userId);clearPreview();setNotice("方案已放弃，视频没有修改。"); }); }
  async function acceptPlan(next:StudioAiPlan) {
    if(lock.current||receiptPending)throw new Error("请先完成当前修改记录同步。");
    if(!runtime||!next.snapshot)throw new Error("当前视频不可用。");
    const current=await runtime.snapshot();
    if(current.revision!==next.snapshot.revision||current.compositionId!==next.snapshot.compositionId)throw new Error("生成方案期间视频已改变，请重新发送要求。");
    await saveStudioPlan(userId,{plan:next});clearPreview();setPlan(next);setTarget(current);setNotice("");setError("");
  }
  function toggleAction(index: number, checked: boolean) { setConfirmed(current => { const next = new Set(current);if (checked) next.add(index);else next.delete(index);return next; }); }

  async function applyPlan() {
    await applyConfirmedPlan(confirmed);
  }
  async function confirmAllAndApply() {
    if(!plan||applied)return;
    const selected=new Set(plan.actions.map((_,index)=>index));setConfirmed(selected);
    await applyConfirmedPlan(selected);
  }
  async function applyConfirmedPlan(selected:ReadonlySet<number>) {
    if (!runtime || !plan || applied || selected.size !== plan.actions.length) return;
    await run(async () => {
      const snapshot = await runtime.snapshot();
      if (snapshot.compositionId !== plan.snapshot?.compositionId || snapshot.revision !== plan.snapshot.revision) throw new Error("当前视频或素材已改变，请重新预览方案。");
      const edit = await confirmStudioPlan(token, plan, selected);
      if (plan.actions.some(action => action.type !== "export")) await runtime.applyEdit(edit);
      const saved = await runtime.snapshot();setTarget(saved);setApplied(saved.revision);setCanUndo(plan.actions.some(action => action.type !== "export"));setActionUndoAvailable(saved.editReceipt?.canUndo ?? false);setReceiptPending(true);
      setNotice("修改已应用。可在时间线预览，满意后导出视频。");
      const session: StudioAiSession = { plan, appliedRevision: saved.revision, receiptSynced: false, undoneActions: saved.editReceipt?.undone ?? [], actionUndoAvailable: saved.editReceipt?.canUndo ?? false };
      await saveStudioPlan(userId, session);await completeStudioPlan(token, plan);
      await saveStudioPlan(userId, { ...session, receiptSynced: true });setReceiptPending(false);
    });
  }

  async function retryReceipt() {
    if (!plan) return;
    await run(async () => { await completeStudioPlan(token, plan, exportReceipt);await saveStudioPlan(userId, { plan, appliedRevision: applied, receiptSynced: true, exportedOnce, exportReceipt, undoneActions, actionUndoAvailable, completelyUndone });setReceiptPending(false);if (runtime?.projectId() !== plan.snapshot?.compositionId) clearPreview();setNotice("修改记录已同步，没有重复修改视频。"); });
  }

  async function undoAppliedAction(actionIndex?: number) {
    if (!runtime || !plan?.approval || !plan.snapshot || !applied || receiptPending || !actionUndoAvailable) return;
    await run(async () => {
      const saved = await runtime.undoAction({ id: plan.approval!.id, compositionId: plan.snapshot!.compositionId, revision: applied, ...(actionIndex === undefined ? {} : { actionIndex }) });
      const receipt = saved.editReceipt;
      if (!receipt || receipt.id !== plan.approval!.id) throw new Error("撤销已执行，但动作回执不可用，请刷新恢复记录。");
      setTarget(saved);setApplied(saved.revision);setUndoneActions(receipt.undone);setActionUndoAvailable(receipt.canUndo);setCanUndo(receipt.canUndo);setCompletelyUndone(receipt.complete);
      await saveStudioPlan(userId, { plan, appliedRevision: saved.revision, receiptSynced: true, exportedOnce, exportReceipt, undoneActions: receipt.undone, actionUndoAvailable: receipt.canUndo, completelyUndone: receipt.complete });
      setNotice(actionIndex === undefined ? "已撤销本次修改，可以调整要求后重新预览方案。" : "该动作已撤销，其他动作保留。已导出的文件不受影响。");
    });
  }

  async function undoPlan() {
    if (!runtime || !plan?.approval || !plan.snapshot || !applied || receiptPending || !canUndo) return;
    if (actionUndoAvailable) { await undoAppliedAction();return; }
    await run(async () => {
      await runtime.undoEdit({ id: plan.approval!.id, compositionId: plan.snapshot!.compositionId, appliedRevision: applied, originalRevision: plan.snapshot!.revision });
      await clearStudioPlan(userId);clearPreview();await refreshTarget();setNotice("已撤销本次修改，可以调整要求后重新预览方案。");
    });
  }

  async function exportVideo() {
    if (!runtime || receiptPending) return;
    await run(async () => {
      const snapshot = await runtime.snapshot();
      if (undoneActions.length || !plan?.exportFormat || !applied || !snapshot.cut || snapshot.cut.transitions?.length || snapshot.cut.images?.length || !desktopVideoBridge()) {
        runtime.openExport();setNotice("请在导出窗口确认格式和文件名，完成后可在下方预览并保存成片。");return;
      }
      if (snapshot.revision !== applied || snapshot.compositionId !== plan.snapshot?.compositionId) throw new Error("视频已改变，请重新预览导出方案。");
      if (exportedOnce) return;
      const saved = await exportStudioCut(runtime, snapshot.cut);
      if (!saved) { setNotice("已取消导出，没有生成文件。");return; }
      setExportedOnce(true);setNotice(`成片已保存：${saved.path}`);
      const name = saved.path.split(/[\\/]/).pop();
      if (!saved.previewId || !name) { await saveStudioPlan(userId, { plan, appliedRevision: applied, receiptSynced: true, exportedOnce: true });throw new Error("成片已保存，但预览未登记，请从素材目录打开。"); }
      const receipt = { previewId: saved.previewId, name };setExportReceipt(receipt);setReceiptPending(true);
      const session = { plan, appliedRevision: applied, receiptSynced: false, exportedOnce: true, exportReceipt: receipt };
      await saveStudioPlan(userId, session);
      const entry = (await desktopVideoBridge()!.listExportPreviews()).find(item => item.id === saved.previewId);
      if (!entry) throw new Error("成片已保存，但预览尚不可用，请从素材目录打开。");
      exported(await recoverDesktopExport(userId, entry));await completeStudioPlan(token, plan, receipt);
      await saveStudioPlan(userId, { ...session, receiptSynced: true });setReceiptPending(false);
    });
  }

  async function importMusic(file: File) {
    if (!runtime) return;
    await run(async () => {
      if (!["audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/mp4"].includes(file.type) || !file.size || file.size > 250 * 1024 * 1024) throw new Error("请选择不超过250MB的MP3、WAV、OGG或M4A音乐文件。");
      const names = new Set(runtime.listMedia().map(item => item.name));await runtime.importAsset(file);
      const added = runtime.listMedia().find(item => !names.has(item.name) && item.mimeType.startsWith("audio/"));
      if (!added) throw new Error("音乐没有加入当前工程，请重新导入。");
      setMusic(added.name);setMediaVersion(value => value + 1);setNotice("音乐已导入，请确认音量后预览方案。");
    });
  }

  const media = runtime?.listMedia() ?? [];
  return { prompt, setPrompt, promptRef, context, target, plan, confirmed, busy, restoring, error, notice, applied, canUndo, receiptPending, exportedOnce, undoneActions, actionUndoAvailable, completelyUndone, undoAppliedAction,
    music, setMusic, volume, setVolume, musicStart, setMusicStart, audio: media.filter(item => item.mimeType.startsWith("audio/")), hasVideo: media.some(item => item.mimeType.startsWith("video/")),
    previewPlan, applyPlan, confirmAllAndApply, discardPlan, undoPlan, retryReceipt, exportVideo, toggleAction, addRequest, importMusic, removeContext, acceptPlan, refreshTarget };
}
