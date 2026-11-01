"use client";

import { Activity, Check, ChevronDown, Lightbulb, Pause, Play, RotateCcw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { AgentConnector, AgentGoal, AgentGoalStatus, AgentMemory, AgentSuggestion } from "@helstera/shared";
import { AgentDocumentResult } from "./agent-document-result";
import { AgentActionReview } from "./agent-action-review";
import { useLocale } from "../lib/i18n";
import type { WebSocketHandle } from "../hooks/use-websocket";
import {
  acceptAgentSuggestion,
  confirmAgentGoal,
  createAgentGoal,
  deleteAgentMemory,
  dismissAgentSuggestion,
  fetchAgentConnectors,
  fetchAgentGoal,
  fetchAgentGoals,
  fetchAgentMemories,
  fetchAgentSuggestions,
  resolveAgentGoalApproval,
  reviewAgentGoalAction,
  setAgentConnectorEnabled,
  setAgentMarketplaceEnabled,
  updateAgentGoal,
} from "../lib/server-api";

type Props = {
  accessToken: string;
  canvasId: string;
  chatSessionId?: string;
  goalId?: string;
  ws?: Pick<WebSocketHandle, "onEvent">;
};

const activeStatuses = new Set<AgentGoalStatus>(["draft", "running", "waiting_approval", "waiting_desktop", "paused"]);

const modeOptions = ["automatic", "isolated_browser", "connected_browser_tab", "windows_ui", "visual_ocr"] as const;
const outputOptions = ["auto", "canvas", "document", "image", "video", "bundle"] as const;

const copy = {
  "zh-CN": {
    title: "Agent 工作区",
    eyebrow: "PERSONAL CREATIVE AGENT",
    newGoal: "创建新目标",
    placeholder: "告诉 Agent 你想完成什么，例如：整理素材并生成一份可编辑的创作结果。",
    create: "生成计划",
    creating: "正在生成…",
    planReady: "计划已准备好",
    confirm: "确认并开始",
    confirmHint: "确认后才会执行浏览器、桌面、上传、生成或付费等动作。",
    output: "结果类型",
    mode: "执行方式",
    recent: "最近目标",
    select: "选择目标",
    noGoal: "当前画布还没有 Agent 目标",
    active: "进行中",
    waiting: "等待处理",
    waitingDesktop: "等待桌面连接",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    canceled: "已取消",
    draft: "待确认",
    plan: "执行计划",
    activity: "活动记录",
    assets: "结果与素材",
    approvals: "需要确认",
    suggestions: "主动建议",
    memories: "已学习偏好",
    connectors: "连接器",
    accept: "使用建议",
    dismiss: "忽略",
    forget: "忘记",
    waitingActivity: "等待 Agent 活动…",
    noSuggestions: "暂时没有新的建议",
    noMemories: "还没有记录偏好",
    noConnectors: "没有可用连接器",
    approve: "批准",
    reject: "拒绝",
    pause: "暂停",
    resume: "继续",
    retry: "重试",
    cancel: "取消",
    local: "本地",
    connected: "已连接",
    available: "可用",
    enable: "启用",
    disable: "停用",
  },
  "en-US": {
    title: "Agent workspace",
    eyebrow: "PERSONAL CREATIVE AGENT",
    newGoal: "New goal",
    placeholder: "Tell the Agent what you want to accomplish, such as organizing material into an editable creative result.",
    create: "Prepare plan",
    creating: "Preparing…",
    planReady: "Plan ready",
    confirm: "Confirm and start",
    confirmHint: "Browser, desktop, upload, generation, and paid actions start only after confirmation.",
    output: "Output",
    mode: "Execution",
    recent: "Recent goals",
    select: "Select a goal",
    noGoal: "No Agent goal on this canvas",
    active: "Active",
    waiting: "Waiting",
    waitingDesktop: "Waiting for desktop",
    paused: "Paused",
    completed: "Completed",
    failed: "Failed",
    canceled: "Canceled",
    draft: "Ready for confirmation",
    plan: "Plan",
    activity: "Activity",
    assets: "Results and assets",
    approvals: "Needs approval",
    suggestions: "Suggestions",
    memories: "Learned preferences",
    connectors: "Connectors",
    accept: "Use suggestion",
    dismiss: "Dismiss",
    forget: "Forget",
    waitingActivity: "Waiting for Agent activity…",
    noSuggestions: "No new suggestions",
    noMemories: "No learned preferences yet",
    noConnectors: "No connectors available",
    approve: "Approve",
    reject: "Reject",
    pause: "Pause",
    resume: "Resume",
    retry: "Retry",
    cancel: "Cancel",
    local: "Local",
    connected: "Connected",
    available: "Available",
    enable: "Enable",
    disable: "Disable",
  },
} as const;

function statusLabel(status: AgentGoalStatus, t: typeof copy[keyof typeof copy]) {
  return ({
    draft: t.draft,
    running: t.active,
    waiting_approval: t.approvals,
    waiting_desktop: t.waitingDesktop,
    paused: t.paused,
    completed: t.completed,
    failed: t.failed,
    canceled: t.canceled,
  })[status];
}

function modeLabel(mode: AgentGoal["executionMode"], english: boolean) {
  return ({
    automatic: english ? "Automatic" : "自动执行",
    isolated_browser: english ? "Isolated browser" : "隔离浏览器",
    connected_browser_tab: english ? "Authorized browser tab" : "已授权浏览器标签",
    windows_ui: english ? "Native desktop controls" : "桌面控件",
    visual_ocr: english ? "Visual OCR" : "视觉 OCR",
  })[mode];
}

function outputLabel(output: AgentGoal["outputKind"], english: boolean) {
  return ({
    auto: english ? "Automatic" : "自动选择",
    canvas: english ? "Canvas" : "画布",
    document: english ? "Document" : "文档",
    image: english ? "Image" : "图片",
    video: english ? "Video" : "视频",
    bundle: english ? "Asset bundle" : "素材包",
  })[output];
}

function taskAsset(task: AgentGoal["tasks"][number], key: "screenshotAsset" | "recordingAsset") {
  const value = task.result?.[key];
  if (!value || typeof value !== "object") return null;
  const url = (value as { url?: unknown }).url;
  return typeof url === "string" ? url : null;
}

function goalRevision(goal: AgentGoal): number {
  const dates = [goal.updatedAt, ...goal.activities.map((activity) => activity.createdAt), ...goal.tasks.map((task) => task.updatedAt)]
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return Math.max(0, ...dates);
}

function shouldUseGoal(current: AgentGoal, next: AgentGoal): boolean {
  const currentRevision = goalRevision(current);
  const nextRevision = goalRevision(next);
  if (nextRevision !== currentRevision) return nextRevision > currentRevision;
  if (next.activities.length !== current.activities.length) return next.activities.length > current.activities.length;
  if (next.tasks.length !== current.tasks.length) return next.tasks.length > current.tasks.length;
  return true;
}

function mergeGoal(current: AgentGoal[], next: AgentGoal): AgentGoal[] {
  const index = current.findIndex((goal) => goal.id === next.id);
  if (index < 0) return [next, ...current].slice(0, 50);
  const existing = current[index];
  if (!existing || !shouldUseGoal(existing, next)) return current;
  const merged = [...current];
  merged[index] = next;
  return merged;
}

function mergeGoals(current: AgentGoal[], next: AgentGoal[]): AgentGoal[] {
  return next.map((incoming) => {
    const existing = current.find((goal) => goal.id === incoming.id);
    return existing && !shouldUseGoal(existing, incoming) ? existing : incoming;
  });
}

export function AgentWorkspacePanel({ accessToken, canvasId, chatSessionId, goalId, ws }: Props) {
  const english = useLocale() === "en-US";
  const t = english ? copy["en-US"] : copy["zh-CN"];
  const [open, setOpen] = useState(false);
  const [goals, setGoals] = useState<AgentGoal[]>([]);
  const [selectedId, setSelectedId] = useState(goalId);
  const [draft, setDraft] = useState("");
  const [outputKind, setOutputKind] = useState<AgentGoal["outputKind"]>("auto");
  const [executionMode, setExecutionMode] = useState<AgentGoal["executionMode"]>("automatic");
  const [suggestions, setSuggestions] = useState<AgentSuggestion[]>([]);
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [connectors, setConnectors] = useState<AgentConnector[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seenEvents = useRef(new Set<string>());

  const reportError = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : "Unable to update the Agent workspace.");
  }, []);

  useEffect(() => {
    try {
      setSelectedId(goalId ?? window.sessionStorage.getItem(`agent-goal:${canvasId}`) ?? undefined);
    } catch (cause) {
      reportError(cause);
      setSelectedId(goalId);
    }
  }, [canvasId, goalId, reportError]);

  const selectGoal = useCallback((id: string) => {
    setSelectedId(id || undefined);
    try {
      if (id) window.sessionStorage.setItem(`agent-goal:${canvasId}`, id);
      else window.sessionStorage.removeItem(`agent-goal:${canvasId}`);
    } catch (cause) {
      reportError(cause);
    }
  }, [canvasId, reportError]);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchAgentGoals(accessToken);
      setGoals((current) => mergeGoals(current.filter((goal) => goal.canvasId === canvasId), next.filter((goal) => goal.canvasId === canvasId)));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (english ? "Unable to load goals." : "无法加载目标。"));
    } finally {
      setLoading(false);
    }
  }, [accessToken, canvasId, english]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    let disposed = false;
    void Promise.allSettled([
      fetchAgentSuggestions(accessToken),
      fetchAgentMemories(accessToken),
      fetchAgentConnectors(accessToken),
    ]).then(([suggestionResult, memoryResult, connectorResult]) => {
      if (disposed) return;
      if (suggestionResult.status === "fulfilled") setSuggestions(suggestionResult.value);
      if (memoryResult.status === "fulfilled") setMemories(memoryResult.value);
      if (connectorResult.status === "fulfilled") setConnectors(connectorResult.value);
      for (const outcome of [suggestionResult, memoryResult, connectorResult]) {
        if (outcome.status === "rejected") reportError(outcome.reason);
      }
    });
    return () => { disposed = true; };
  }, [accessToken, reportError]);

  useEffect(() => {
    if (!ws) return;
    return ws.onEvent((event) => {
      if (event.type !== "agent.goal" || (event.canvasId && event.canvasId !== canvasId)) return;
      const eventKey = [event.goalId, event.taskId ?? "", event.eventType, event.timestamp, event.detail ?? "", JSON.stringify(event.payload)].join("|");
      if (seenEvents.current.has(eventKey)) return;
      seenEvents.current.add(eventKey);
      void fetchAgentGoal(accessToken, event.goalId).then((next) => {
        if (next.canvasId !== canvasId) return;
        setGoals((current) => mergeGoal(current, next));
      }).catch(reportError);
    });
  }, [accessToken, canvasId, ws, reportError]);

  const selected = useMemo(() => {
    if (selectedId) {
      const goal = goals.find((goal) => goal.id === selectedId && goal.canvasId === canvasId);
      if (goal) return goal;
    }
    return goals.find((goal) => goal.canvasId === canvasId && activeStatuses.has(goal.status))
      ?? goals.find((goal) => goal.canvasId === canvasId)
      ?? null;
  }, [canvasId, goals, selectedId]);

  useEffect(() => {
    if (!selected || !activeStatuses.has(selected.status)) return;
    const timer = window.setInterval(() => {
      void fetchAgentGoal(accessToken, selected.id).then((next) => {
        setGoals((current) => mergeGoal(current, next));
      }).catch(reportError);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [accessToken, selected, reportError]);

  async function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const goal = draft.trim();
    if (!goal || busy) return;
    setBusy(true);
    try {
      const next = await createAgentGoal(accessToken, {
        goal,
        canvasId,
        ...(chatSessionId ? { chatSessionId } : {}),
        executionMode,
        outputKind,
        source: "user",
        executionPolicy: "approval_required",
        capabilities: [],
        attachments: [],
        idempotencyKey: crypto.randomUUID(),
      });
      setGoals((current) => [next, ...current.filter((item) => item.id !== next.id)].slice(0, 50));
      selectGoal(next.id);
      setDraft("");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (english ? "Unable to create the goal." : "无法创建目标。"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmGoal() {
    if (!selected || selected.status !== "draft" || busy) return;
    setBusy(true);
    try {
      const next = await confirmAgentGoal(accessToken, selected.id);
      setGoals((current) => current.map((goal) => goal.id === next.id ? next : goal));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (english ? "Unable to confirm the goal." : "无法确认目标。"));
    } finally {
      setBusy(false);
    }
  }

  async function updateGoal(action: "pause" | "resume" | "cancel" | "retry") {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const next = await updateAgentGoal(accessToken, selected.id, action);
      setGoals((current) => current.map((goal) => goal.id === next.id ? next : goal));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (english ? "Goal update failed." : "目标更新失败。"));
    } finally {
      setBusy(false);
    }
  }

  async function resolveApproval(approvalId: string, decision: "approve" | "reject") {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await resolveAgentGoalApproval(accessToken, selected.id, approvalId, decision);
      const next = await fetchAgentGoal(accessToken, selected.id);
      setGoals((current) => current.map((goal) => goal.id === next.id ? next : goal));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (english ? "Approval failed." : "审批失败。"));
    } finally {
      setBusy(false);
    }
  }

  async function reviewAction(approvalId: string, outcome: "observed_completed" | "observed_not_completed") {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await reviewAgentGoalAction(accessToken, selected.id, approvalId, outcome);
      const next = await fetchAgentGoal(accessToken, selected.id);
      setGoals((current) => current.map((goal) => goal.id === next.id ? next : goal));
      setError(null);
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function useSuggestion(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const accepted = await acceptAgentSuggestion(accessToken, id);
      setSuggestions((current) => current.filter((suggestion) => suggestion.id !== id));
      setGoals((current) => [accepted.goal, ...current.filter((goal) => goal.id !== accepted.goal.id)].slice(0, 50));
      selectGoal(accepted.goal.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (english ? "Unable to use the suggestion." : "无法使用建议。"));
    } finally {
      setBusy(false);
    }
  }

  async function forgetMemory(id: string) {
    try {
      await deleteAgentMemory(accessToken, id);
      setMemories((current) => current.filter((memory) => memory.id !== id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (english ? "Unable to forget the memory." : "无法删除记忆。"));
    }
  }

  async function dismissSuggestion(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await dismissAgentSuggestion(accessToken, id);
      setSuggestions((current) => current.filter((item) => item.id !== id));
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function toggleConnector(connector: AgentConnector) {
    if (busy || connector.status === "blocked") return;
    setBusy(true);
    try {
      const enabled = !connector.enabled;
      if (connector.id.startsWith("marketplace:")) {
        await setAgentMarketplaceEnabled(accessToken, connector.id.slice("marketplace:".length), enabled);
      } else {
        await setAgentConnectorEnabled(accessToken, connector.id, enabled, connector.permissions);
      }
      setConnectors(await fetchAgentConnectors(accessToken));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (english ? "Unable to update the connector." : "无法更新连接器。"));
    } finally {
      setBusy(false);
    }
  }

  const latestActivities = selected?.activities.slice(0, 10) ?? [];
  const activeConnectorCount = connectors.filter((connector) => connector.enabled && ["available", "connected"].includes(connector.status)).length;

  return <>
    <button type="button" className="agent-workspace-launcher" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={t.title}>
      <Sparkles size={16} aria-hidden="true" />
      <span>{t.title}</span>
      {selected && activeStatuses.has(selected.status) ? <i aria-label={t.active} /> : null}
    </button>
    {open ? <aside className="agent-workspace-panel" aria-label={t.title} aria-busy={loading}>
      {loading ? <p role="status">{english ? "Loading goals…" : "正在加载目标…"}</p> : null}
      <header className="agent-workspace-panel__header">
        <div><span className="agent-workspace-panel__eyebrow">{t.eyebrow}</span><h2>{selected?.goal ?? t.noGoal}</h2></div>
        <button type="button" className="agent-workspace-icon-button" onClick={() => setOpen(false)} aria-label={english ? "Close" : "关闭"}><X size={16} /></button>
      </header>

      <form className="agent-workspace-composer" onSubmit={submitGoal}>
        <label><span>{t.newGoal}</span><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t.placeholder} rows={3} /></label>
        <div className="agent-workspace-selects">
          <label><span>{t.output}</span><select value={outputKind} onChange={(event) => setOutputKind(event.target.value as AgentGoal["outputKind"])}>{outputOptions.map((value) => <option key={value} value={value}>{outputLabel(value, english)}</option>)}</select></label>
          <label><span>{t.mode}</span><select value={executionMode} onChange={(event) => setExecutionMode(event.target.value as AgentGoal["executionMode"])}>{modeOptions.map((value) => <option key={value} value={value}>{modeLabel(value, english)}</option>)}</select></label>
        </div>
        <button type="submit" className="agent-workspace-primary" disabled={busy || !draft.trim()}><Sparkles size={14} aria-hidden="true" />{busy ? t.creating : t.create}</button>
      </form>

      {suggestions.length ? <section className="agent-workspace-section agent-workspace-suggestions"><h3><Lightbulb size={14} aria-hidden="true" />{t.suggestions}</h3>{suggestions.slice(0, 3).map((suggestion) => <article key={suggestion.id}><strong>{suggestion.title}</strong><p>{suggestion.detail}</p><div><button type="button" disabled={busy} onClick={() => void useSuggestion(suggestion.id)}>{t.accept}</button><button type="button" disabled={busy} onClick={() => void dismissSuggestion(suggestion.id)}>{t.dismiss}</button></div></article>)}</section> : null}

      {goals.length > 1 ? <label className="agent-workspace-recent">{t.recent}<select value={selected?.id ?? ""} onChange={(event) => selectGoal(event.target.value)}><option value="">{t.select}</option>{goals.slice(0, 20).map((goal) => <option key={goal.id} value={goal.id}>{goal.goal.slice(0, 70)}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></label> : null}

      {selected ? <>
        {selected.result?.summary || selected.result?.documents?.length ? <section className="agent-workspace-section"><h3>{t.assets}</h3><p>{selected.result.summary}</p>{selected.result.documents?.map((report) => <AgentDocumentResult key={report.id} report={report} english={english} />)}</section> : null}
        <div className="agent-workspace-status"><strong>{statusLabel(selected.status, t)}</strong><span>{modeLabel(selected.executionMode, english)} · {outputLabel(selected.outputKind, english)}</span></div>
        <AgentActionReview goal={selected} english={english} busy={busy} onReview={(approvalId, outcome) => void reviewAction(approvalId, outcome)} />
        {selected.status === "draft" ? <section className="agent-workspace-confirm"><strong>{t.planReady}</strong><p>{t.confirmHint}</p><button type="button" disabled={busy} onClick={() => void confirmGoal()}><Check size={14} aria-hidden="true" />{t.confirm}</button></section> : null}
        <div className="agent-workspace-actions">
          {selected.status === "paused" ? <button type="button" disabled={busy} onClick={() => void updateGoal("resume")}><Play size={14} aria-hidden="true" />{t.resume}</button> : null}
          {selected.status === "running" ? <button type="button" disabled={busy} onClick={() => void updateGoal("pause")}><Pause size={14} aria-hidden="true" />{t.pause}</button> : null}
          {["failed", "canceled"].includes(selected.status) ? <button type="button" disabled={busy} onClick={() => void updateGoal("retry")}><RotateCcw size={14} aria-hidden="true" />{t.retry}</button> : null}
          {activeStatuses.has(selected.status) && selected.status !== "draft" ? <button type="button" disabled={busy} onClick={() => void updateGoal("cancel")}><X size={14} aria-hidden="true" />{t.cancel}</button> : null}
        </div>
        <section className="agent-workspace-section"><h3>{t.plan}</h3><ol className="agent-workspace-plan">{selected.plan.steps.map((step) => <li key={step.id} data-state={step.status}><span>{step.status === "succeeded" ? <Check size={13} aria-hidden="true" /> : step.id.slice(0, 1).toUpperCase()}</span><div><strong>{step.title}</strong><small>{step.requiresApproval ? t.approvals : step.risk === "read_only" ? (english ? "Read only" : "只读") : (english ? "Automatic" : "自动执行")}</small></div></li>)}</ol></section>
        {selected.approvals.filter((approval) => approval.status === "pending").length ? <section className="agent-workspace-section"><h3>{t.approvals}</h3>{selected.approvals.filter((approval) => approval.status === "pending").map((approval) => <article className="agent-workspace-approval" key={approval.approvalId}><strong>{approval.action.kind}</strong><p>{approval.action.target ?? approval.action.targetUrl ?? ""}</p><div><button type="button" disabled={busy} onClick={() => void resolveApproval(approval.approvalId, "approve")}>{t.approve}</button><button type="button" disabled={busy} onClick={() => void resolveApproval(approval.approvalId, "reject")}>{t.reject}</button></div></article>)}</section> : null}
        <section className="agent-workspace-section"><h3>{t.activity}</h3>{latestActivities.length ? <ol className="agent-workspace-activity">{latestActivities.map((activity) => <li key={`${activity.id}-${activity.createdAt}`}><span>{activity.eventType.replace("goal.", "")}</span><time>{new Date(activity.createdAt).toLocaleTimeString()}</time>{activity.detail ? <p>{activity.detail}</p> : null}</li>)}</ol> : <p className="agent-workspace-empty">{t.waitingActivity}</p>}</section>
        {selected.tasks.some((task) => taskAsset(task, "screenshotAsset") || taskAsset(task, "recordingAsset")) ? <section className="agent-workspace-section"><h3>{t.assets}</h3><div className="agent-workspace-assets">{selected.tasks.flatMap((task) => [taskAsset(task, "screenshotAsset") ? <a key={`${task.taskId}-screen`} href={taskAsset(task, "screenshotAsset")!} target="_blank" rel="noreferrer">{english ? "Screenshot" : "截图"}</a> : null, taskAsset(task, "recordingAsset") ? <a key={`${task.taskId}-recording`} href={taskAsset(task, "recordingAsset")!} target="_blank" rel="noreferrer">{english ? "Recording" : "录屏"}</a> : null])}</div></section> : null}
      </> : null}

      <section className="agent-workspace-section"><h3>{t.connectors}<span className="agent-workspace-count">{activeConnectorCount}/{connectors.length}</span></h3>{connectors.length ? <ul className="agent-workspace-connectors">{connectors.slice(0, 8).map((connector) => <li key={connector.id}><div><span>{connector.name}</span><small>{connector.status === "connected" ? t.connected : connector.status === "available" ? t.available : connector.kind === "local_files" ? t.local : connector.status}</small></div><button type="button" disabled={busy || connector.status === "blocked"} onClick={() => void toggleConnector(connector)}>{connector.enabled ? t.disable : t.enable}</button></li>)}</ul> : <p className="agent-workspace-empty">{t.noConnectors}</p>}</section>
      <section className="agent-workspace-section"><h3>{t.memories}</h3>{memories.length ? <ul className="agent-workspace-memories">{memories.slice(0, 5).map((memory) => <li key={memory.id}><span>{memory.value}</span><button type="button" onClick={() => void forgetMemory(memory.id)}>{t.forget}</button></li>)}</ul> : <p className="agent-workspace-empty">{t.noMemories}</p>}</section>
      {error ? <p className="agent-workspace-error" role="alert">{error}</p> : null}
    </aside> : null}
  </>;
}
