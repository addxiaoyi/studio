"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/lib/i18n";
import { cancelDesktopAgentTask, fetchDesktopAgentTask, resolveDesktopAgentApproval, type DesktopAgentTaskResponse } from "@/lib/server-api";

type Preview = { kind: "image" | "video"; url: string; title: string };
type Event = DesktopAgentTaskResponse["events"][number];

const modes = {
  zh: { automatic: "自动选择", isolated_browser: "隔离浏览器", connected_browser_tab: "授权浏览器标签", windows_ui: "本机控件树 / Windows UI", visual_ocr: "本机视觉 / OCR" },
  en: { automatic: "Automatic", isolated_browser: "Isolated browser", connected_browser_tab: "Authorized browser tab", windows_ui: "Native controls / Windows UI", visual_ocr: "Native vision / OCR" },
} as const;

const eventLabels = {
  zh: { started: "任务启动", plan: "执行计划", step: "执行步骤", evidence: "收集证据", asset_created: "素材已保存", progress: "执行进度", page: "网页证据", approval_required: "等待审批", approval_expired: "审批已过期", deadline_warning: "接近任务时限", completed: "已完成", failed: "失败", canceled: "已取消" },
  en: { started: "Task started", plan: "Execution plan", step: "Action", evidence: "Evidence", asset_created: "Asset saved", progress: "Progress", page: "Page evidence", approval_required: "Awaiting approval", approval_expired: "Approval expired", deadline_warning: "Time limit approaching", completed: "Completed", failed: "Failed", canceled: "Canceled" },
} as const;

function eventLabel(event: Event, english: boolean) {
  const copy = eventLabels[english ? "en" : "zh"];
  if (event.stepId === "reobserve" || event.eventType === "reobserve") {
    const round = event.detail?.match(/(?:round\s+|第\s*)(\d+)(?:\s*轮)?/i)?.[1];
    if (round) return english ? `Round ${round}: observe and re-plan` : `第 ${round} 轮：重新观察并规划`;
    return english ? "Re-observing" : "重新观察并规划";
  }
  if (event.eventType === "visual_grounding") {
    const detail = event.detail?.toLowerCase() ?? "";
    const failed = event.detail?.includes("失败") || detail.includes("failed");
    const complete = event.detail?.includes("完成") || event.detail?.includes("成功") || detail.includes("grounded");
    if (english) return failed ? "Visual grounding failed" : complete ? "Visual target located" : "Locating visual target";
    return failed ? "视觉定位失败" : complete ? "视觉定位完成" : "正在视觉定位";
  }
  return copy[event.eventType as keyof typeof copy] ?? event.eventType;
}

function assetUrl(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const url = (value as { url?: unknown }).url;
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url, window.location.origin);
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    if (parsed.protocol === "https:" || (parsed.protocol === "http:" && localHost && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname))) return parsed.href;
  } catch {
    return null;
  }
  return null;
}

export function DesktopAgentProgressCard({ taskId }: { taskId: string }) {
  const { session } = useAuth();
  const english = useLocale() === "en-US";
  const copy = english ? {
    loading: "Loading task…", failedToLoad: "Unable to load Agent task", actionError: "Unable to complete this action",
    queued: "Queued", running: "Running", succeeded: "Completed", failed: "Failed", canceled: "Canceled",
    title: "Desktop Agent task", mode: "Mode", capabilities: "Capabilities", timeline: "Task timeline",
    screenshot: "Task screenshot", previewScreenshot: "Preview screenshot", recording: "Recording draft", previewRecording: "Preview recording",
    viewCanvas: "Open in canvas", approval: "Approval required", approvalExpired: "Approval expired. The action was not run.",
    approve: "Approve", reject: "Reject", cancel: "Cancel task", working: "Working…", closePreview: "Close preview",
  } : {
    loading: "正在读取任务…", failedToLoad: "无法读取 Agent 任务", actionError: "无法完成此操作",
    queued: "排队中", running: "执行中", succeeded: "已完成", failed: "失败", canceled: "已取消",
    title: "桌面 Agent 任务", mode: "执行模式", capabilities: "能力", timeline: "任务时间线",
    screenshot: "任务截图", previewScreenshot: "预览截图", recording: "录屏草稿", previewRecording: "预览录屏",
    viewCanvas: "在画布中查看", approval: "需要确认", approvalExpired: "审批已过期，此操作未执行。",
    approve: "批准", reject: "拒绝", cancel: "取消任务", working: "处理中…", closePreview: "关闭预览",
  };
  const [task, setTask] = useState<DesktopAgentTaskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const terminalNoticeSent = useRef(false);

  useEffect(() => {
    if (!preview) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [preview]);

  useEffect(() => {
    const token = session?.access_token;
    if (!token) return;
    let disposed = false;
    let timeout: number | undefined;
    const load = async () => {
      try {
        const next = await fetchDesktopAgentTask(token, taskId);
        if (disposed) return;
        if (!terminalNoticeSent.current && next.chatSessionId && ["succeeded", "failed", "canceled"].includes(next.status)) {
          terminalNoticeSent.current = true;
          window.dispatchEvent(new CustomEvent("helstera:desktop-agent-result", { detail: { sessionId: next.chatSessionId } }));
        }
        setTask(next);
        setError(null);
        if (!["succeeded", "failed", "canceled"].includes(next.status) || next.pendingApprovals.length) timeout = window.setTimeout(() => void load(), 2_000);
      } catch (cause) {
        if (disposed) return;
        setError(cause instanceof Error ? cause.message : copy.failedToLoad);
        timeout = window.setTimeout(() => void load(), 5_000);
      }
    };
    void load();
    return () => {
      disposed = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [copy.failedToLoad, session?.access_token, taskId]);

  async function act(action: () => Promise<unknown>) {
    if (!session?.access_token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setTask(await fetchDesktopAgentTask(session.access_token, taskId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.actionError);
    } finally {
      setBusy(false);
    }
  }

  if (!task) return <div role={error ? "alert" : "status"} className="desktop-agent-task-card">{error ?? copy.loading}</div>;

  const result = task.result ?? {};
  const screenshot = assetUrl(result.screenshotAsset);
  const recording = assetUrl(result.recordingAsset);
  const page = result.page as { title?: string; url?: string; description?: string; headings?: string[] } | undefined;
  const status = ({ queued: copy.queued, running: copy.running, succeeded: copy.succeeded, failed: copy.failed, canceled: copy.canceled } as const)[task.status];
  const expiredApproval = task.events.some((event) => event.eventType === "approval_expired");
  const canvasPath = task.canvasId
    ? `${document.documentElement.dataset.helsteraDesktop === "true" ? "/desktop-app/canvas/" : "/canvas/"}?${new URLSearchParams({ id: task.canvasId })}`
    : null;

  return <section className="desktop-agent-task-card" aria-label={copy.title}>
    <header><div><strong>Desktop Agent · {status}</strong><p>{task.goal}</p></div><span>{task.role}</span></header>
    <div className="desktop-agent-task-card__meta"><span>{copy.mode}: {modes[english ? "en" : "zh"][task.executionMode ?? "automatic"] ?? task.executionMode}</span><span>{copy.capabilities}: {task.capabilities.join(" · ")}</span></div>
    {canvasPath ? <a className="desktop-agent-task-card__canvas-link" href={canvasPath}>{copy.viewCanvas}</a> : null}
    {expiredApproval ? <p className="desktop-agent-task-card__approval-expired" role="status">{copy.approvalExpired}</p> : null}
    {task.events.length ? <ol className="desktop-agent-task-card__timeline" aria-label={copy.timeline}>{[...task.events].reverse().map((event, index) => {
      const eventResult = event.result ?? {};
      const eventScreenshot = assetUrl(eventResult.screenshotAsset);
      const eventPage = eventResult.page as { title?: string } | undefined;
      return <li key={`${event.createdAt}-${index}`}><div><strong>{eventLabel(event, english)}</strong><time>{new Date(event.createdAt).toLocaleTimeString()}</time></div>{event.detail ? <p>{event.detail}</p> : null}{eventPage?.title ? <p>{eventPage.title}</p> : null}{eventScreenshot ? <button type="button" onClick={() => setPreview({ kind: "image", url: eventScreenshot, title: eventPage?.title ?? copy.screenshot })}><img src={eventScreenshot} alt={copy.screenshot}/>{copy.previewScreenshot}</button> : null}</li>;
    })}</ol> : null}
    {page ? <div className="desktop-agent-task-card__page"><strong>{page.title || (english ? "Page read" : "已读取页面")}</strong>{page.url ? <a href={page.url} target="_blank" rel="noreferrer">{page.url}</a> : null}{page.description ? <p>{page.description}</p> : null}{page.headings?.length ? <p>{page.headings.slice(0, 8).join(" · ")}</p> : null}</div> : null}
    {typeof result.summary === "string" ? <p className="desktop-agent-task-card__summary">{result.summary}</p> : null}
    <div className="desktop-agent-task-card__assets">{screenshot ? <button type="button" onClick={() => setPreview({ kind: "image", url: screenshot, title: copy.screenshot })}>{copy.previewScreenshot}</button> : null}{recording ? <button type="button" onClick={() => setPreview({ kind: "video", url: recording, title: copy.recording })}>▶ {copy.previewRecording}</button> : null}</div>
    {task.pendingApprovals.map((approval) => <div key={approval.approvalId} className="desktop-agent-task-card__approval"><strong>{copy.approval}: {approval.action.kind} · {approval.action.target ?? approval.action.targetUrl ?? ""}</strong><div><button type="button" disabled={busy} onClick={() => void act(() => resolveDesktopAgentApproval(session!.access_token, approval.approvalId, "approve"))}>{copy.approve}</button><button type="button" disabled={busy} onClick={() => void act(() => resolveDesktopAgentApproval(session!.access_token, approval.approvalId, "reject"))}>{copy.reject}</button></div></div>)}
    {["queued", "running"].includes(task.status) ? <button type="button" className="desktop-agent-task-card__cancel" disabled={busy} onClick={() => void act(() => cancelDesktopAgentTask(session!.access_token, taskId))}>{busy ? copy.working : copy.cancel}</button> : null}
    {task.error || error ? <p className="desktop-agent-task-card__error" role="alert">{task.error ?? error}</p> : null}
    {preview ? <div className="desktop-agent-preview" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}><section role="dialog" aria-modal="true" aria-label={preview.title}><header><strong>{preview.title}</strong><button type="button" onClick={() => setPreview(null)} aria-label={copy.closePreview}>×</button></header>{preview.kind === "image" ? <img src={preview.url} alt={preview.title}/> : <video src={preview.url} controls autoPlay preload="metadata"/>}</section></div> : null}
  </section>;
}
