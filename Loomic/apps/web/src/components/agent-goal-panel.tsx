"use client";

import { Activity, Check, ChevronDown, Pause, Play, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { AgentGoal, AgentGoalStatus } from "@helstera/shared";
import { useLocale } from "../lib/i18n";
import type { WebSocketHandle } from "../hooks/use-websocket";
import {
  fetchAgentGoal,
  fetchAgentGoals,
  resolveAgentGoalApproval,
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

const modeLabels = {
  "zh-CN": {
    automatic: "自动执行",
    isolated_browser: "隔离浏览器",
    connected_browser_tab: "已授权浏览器标签",
    windows_ui: "本机控件树",
    visual_ocr: "视觉 OCR",
  },
  "en-US": {
    automatic: "Automatic",
    isolated_browser: "Isolated browser",
    connected_browser_tab: "Authorized browser tab",
    windows_ui: "Native controls",
    visual_ocr: "Visual OCR",
  },
} as const;

function statusLabel(status: AgentGoalStatus, english: boolean) {
  const labels = english
    ? { draft: "Draft", running: "Running", waiting_approval: "Waiting approval", waiting_desktop: "Waiting for desktop", paused: "Paused", completed: "Completed", failed: "Failed", canceled: "Canceled" }
    : { draft: "草稿", running: "运行中", waiting_approval: "等待审批", waiting_desktop: "等待桌面连接", paused: "已暂停", completed: "已完成", failed: "失败", canceled: "已取消" };
  return labels[status];
}

function taskAsset(task: AgentGoal["tasks"][number], key: "screenshotAsset" | "recordingAsset") {
  const value = task.result?.[key];
  if (!value || typeof value !== "object") return null;
  const url = (value as { url?: unknown }).url;
  return typeof url === "string" ? url : null;
}

export function AgentGoalPanel({ accessToken, canvasId, chatSessionId, goalId, ws }: Props) {
  const english = useLocale() === "en-US";
  const locale = english ? "en-US" : "zh-CN";
  const [open, setOpen] = useState(false);
  const [goals, setGoals] = useState<AgentGoal[]>([]);
  const [selectedId, setSelectedId] = useState(goalId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchAgentGoals(accessToken);
      setGoals(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (english ? "Unable to load goals" : "无法加载目标"));
    }
  }, [accessToken, english]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!ws) return;
    return ws.onEvent((event) => {
      if (event.type !== "agent.goal") return;
      if (event.canvasId && event.canvasId !== canvasId) return;
      if (selectedId && event.goalId !== selectedId) return;
      void fetchAgentGoal(accessToken, event.goalId)
        .then((next) => {
          setGoals((current) => {
            const exists = current.some((goal) => goal.id === next.id);
            return exists
              ? current.map((goal) => goal.id === next.id ? next : goal)
              : [next, ...current].slice(0, 50);
          });
        })
        .catch((cause: unknown) => {
          console.warn("[agent-goal-panel] event refresh failed", cause);
        });
    });
  }, [accessToken, canvasId, selectedId, ws]);

  const selected = useMemo(() => {
    if (selectedId) return goals.find((goal) => goal.id === selectedId) ?? null;
    return goals.find((goal) => goal.canvasId === canvasId && activeStatuses.has(goal.status))
      ?? goals.find((goal) => goal.canvasId === canvasId)
      ?? null;
  }, [canvasId, goals, selectedId]);

  useEffect(() => {
    if (!selected || !activeStatuses.has(selected.status)) return;
    const refresh = () => {
      void fetchAgentGoal(accessToken, selected.id).then((next) => {
        setGoals((current) => current.map((goal) => goal.id === next.id ? next : goal));
      }).catch((cause: unknown) => {
        console.warn("[agent-goal-panel] refresh failed", cause);
      });
    };
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [accessToken, selected]);

  async function act(action: "pause" | "resume" | "cancel" | "retry") {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const next = await updateAgentGoal(accessToken, selected.id, action);
      setGoals((current) => current.map((goal) => goal.id === next.id ? next : goal));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (english ? "Action failed" : "操作失败"));
    } finally {
      setBusy(false);
    }
  }

  async function decide(approvalId: string, decision: "approve" | "reject") {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await resolveAgentGoalApproval(accessToken, selected.id, approvalId, decision);
      const next = await fetchAgentGoal(accessToken, selected.id);
      setGoals((current) => current.map((goal) => goal.id === next.id ? next : goal));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (english ? "Approval failed" : "审批操作失败"));
    } finally {
      setBusy(false);
    }
  }

  const title = english ? "Agent goals" : "Agent 目标";
  const mode = selected ? modeLabels[locale][selected.executionMode] : null;
  const latestActivities = selected?.activities.slice(0, 12) ?? [];

  return <>
    <button type="button" className="agent-goal-launcher" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={title}>
      <Activity size={16} />
      <span>{title}</span>
      {selected && activeStatuses.has(selected.status) ? <i aria-label={english ? "Active goal" : "有活动目标"} /> : null}
    </button>
    {open ? <aside className="agent-goal-panel" aria-label={title}>
      <header className="agent-goal-panel__header">
        <div><span className="agent-goal-panel__eyebrow">{english ? "WORKSPACE AUTOMATION" : "工作区自动化"}</span><h2>{selected?.goal ?? (english ? "No goal on this canvas" : "当前画布暂无目标")}</h2></div>
        <button type="button" className="agent-goal-icon-button" onClick={() => setOpen(false)} aria-label={english ? "Close" : "关闭"}><X size={16} /></button>
      </header>
      {goals.length > 1 ? <label className="agent-goal-panel__select">{english ? "Recent goals" : "最近目标"}<select value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)}><option value="">{english ? "Select a goal" : "选择目标"}</option>{goals.slice(0, 20).map((goal) => <option key={goal.id} value={goal.id}>{goal.goal.slice(0, 70)}</option>)}</select><ChevronDown size={14} /></label> : null}
      {selected ? <>
        <div className="agent-goal-panel__status"><strong>{statusLabel(selected.status, english)}</strong><span>{mode}</span></div>
        <div className="agent-goal-panel__actions">
          {selected.status === "paused" ? <button type="button" disabled={busy} onClick={() => void act("resume")}><Play size={14} />{english ? "Resume" : "继续"}</button> : null}
          {selected.status === "running" ? <button type="button" disabled={busy} onClick={() => void act("pause")}><Pause size={14} />{english ? "Pause" : "暂停"}</button> : null}
          {["failed", "canceled"].includes(selected.status) ? <button type="button" disabled={busy} onClick={() => void act("retry")}><RotateCcw size={14} />{english ? "Retry" : "重试"}</button> : null}
          {activeStatuses.has(selected.status) ? <button type="button" disabled={busy} onClick={() => void act("cancel")}><X size={14} />{english ? "Cancel" : "取消"}</button> : null}
        </div>
        <section className="agent-goal-panel__section"><h3>{english ? "Plan" : "执行计划"}</h3><ol className="agent-goal-plan">{selected.plan.steps.map((step) => <li key={step.id} data-state={step.status}><span>{step.status === "succeeded" ? <Check size={13} /> : step.id.slice(0, 1).toUpperCase()}</span><div><strong>{step.title}</strong><small>{step.requiresApproval ? (english ? "Approval required" : "需要审批") : step.risk === "read_only" ? (english ? "Read only" : "只读") : (english ? "Automatic" : "自动执行")}</small></div></li>)}</ol></section>
        {selected.approvals.filter((approval) => approval.status === "pending").map((approval) => <section className="agent-goal-approval" key={approval.approvalId}><strong>{english ? "Approval required" : "需要审批"}</strong><p>{approval.action.kind} {approval.action.target ?? approval.action.targetUrl ?? ""}</p><div><button type="button" disabled={busy} onClick={() => void decide(approval.approvalId, "approve")}>{english ? "Approve" : "批准"}</button><button type="button" disabled={busy} onClick={() => void decide(approval.approvalId, "reject")}>{english ? "Reject" : "拒绝"}</button></div></section>)}
        <section className="agent-goal-panel__section"><h3>{english ? "Activity" : "活动记录"}</h3>{latestActivities.length ? <ol className="agent-goal-activity">{latestActivities.map((activity) => <li key={`${activity.id}-${activity.createdAt}`}><span>{activity.eventType.replace("goal.", "")}</span><time>{new Date(activity.createdAt).toLocaleTimeString()}</time>{activity.detail ? <p>{activity.detail}</p> : null}</li>)}</ol> : <p className="agent-goal-panel__empty">{english ? "Waiting for activity" : "等待活动记录"}</p>}</section>
        {selected.tasks.some((task) => taskAsset(task, "screenshotAsset") || taskAsset(task, "recordingAsset")) ? <section className="agent-goal-panel__section"><h3>{english ? "Assets" : "素材"}</h3><div className="agent-goal-assets">{selected.tasks.flatMap((task) => [taskAsset(task, "screenshotAsset") ? <a key={`${task.taskId}-screen`} href={taskAsset(task, "screenshotAsset")!} target="_blank" rel="noreferrer">{english ? "Screenshot" : "截图"}</a> : null, taskAsset(task, "recordingAsset") ? <a key={`${task.taskId}-recording`} href={taskAsset(task, "recordingAsset")!} target="_blank" rel="noreferrer">{english ? "Recording" : "录屏"}</a> : null])}</div></section> : null}
      </> : <p className="agent-goal-panel__empty">{error ?? (english ? "Goals created from chat or the Agent API appear here." : "从聊天或 Agent API 创建的目标会显示在这里。")}</p>}
      {error && selected ? <p className="agent-goal-panel__error" role="alert">{error}</p> : null}
    </aside> : null}
  </>;
}
