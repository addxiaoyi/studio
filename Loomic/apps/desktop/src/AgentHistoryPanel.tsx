import React from "react";
import { readLocalAgentHistory } from "./agent-history-store.js";

type DesktopTaskEvent = {
  eventType: string;
  detail: string | null;
  createdAt: string;
  stepId?: string;
  result?: { screenshotAsset?: { url: string }; recordingAsset?: { url: string } } | null;
};

type DesktopTask = {
  taskId: string;
  goal: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  executionMode?: string;
  createdAt: string;
  completedAt?: string;
  error: string | null;
  result: { screenshotAsset?: { url: string }; recordingAsset?: { url: string }; summary?: string } | null;
  events: DesktopTaskEvent[];
};

const isEnglish = () => {
  if (typeof document === "undefined") return true;
  const lang = document.documentElement?.lang ?? navigator.language ?? "zh-CN";
  return !lang.toLowerCase().startsWith("zh");
};

const STRINGS = {
  zh: {
    title: "Agent 任务历史",
    refresh: "刷新",
    empty: "暂无任务记录。",
    close: "关闭",
    summary: "结果摘要",
    error: "错误",
    screenshot: "截图",
    recording: "录屏",
    events: "事件时间线",
  },
  en: {
    title: "Agent task history",
    refresh: "Refresh",
    empty: "No task history yet.",
    close: "Close",
    summary: "Result summary",
    error: "Error",
    screenshot: "Screenshot",
    recording: "Recording",
    events: "Event timeline",
  },
} as const;

const statusColor: Record<DesktopTask["status"], string> = {
  queued: "#8a8a82",
  running: "#1d4ed8",
  succeeded: "#15803d",
  failed: "#b3261e",
  canceled: "#8a8a82",
};

export function DesktopAgentHistoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tasks, setTasks] = React.useState<DesktopTask[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const S = STRINGS[isEnglish() ? "en" : "zh"];

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const base = typeof window !== "undefined" ? window.location.origin : "";
      const response = await fetch(`${base}/api/website-capture/assistant/desktop-tasks`, { credentials: "include" });
      if (!response.ok) {
        setTasks(readLocalAgentHistory(window.localStorage));
        return;
      }
      const body = (await response.json()) as { ok: boolean; data: DesktopTask[] };
      if (body.ok) setTasks(body.data);
    } catch (error) {
      console.error("[desktop-agent-history] remote history unavailable; using local history", error);
      setTasks(readLocalAgentHistory(window.localStorage));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label={S.title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10_000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div style={{ width: 640, maxHeight: "80vh", overflow: "auto", background: "#fff", borderRadius: 14, padding: 20, color: "#191918", boxShadow: "0 16px 48px rgba(0,0,0,0.2)" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <strong style={{ fontSize: 15 }}>{S.title}</strong>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => void load()} disabled={loading} style={{ minHeight: 30, borderRadius: 7, border: "1px solid #d8d8d2", background: "#fff", cursor: loading ? "wait" : "pointer", fontSize: 12 }}>
              {S.refresh}
            </button>
            <button type="button" onClick={onClose} style={{ minHeight: 30, borderRadius: 7, border: 0, background: "#191918", color: "#fff", cursor: "pointer", fontSize: 12 }}>
              {S.close}
            </button>
          </div>
        </header>
        {tasks.length === 0 ? (
          <p style={{ fontSize: 13, color: "#666660" }}>{S.empty}</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
            {tasks.map((task) => (
              <li key={task.taskId} style={{ border: "1px solid #e2e2dc", borderRadius: 10, padding: 12 }}>
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === task.taskId ? null : task.taskId)}
                  style={{ width: "100%", textAlign: "left", background: "none", border: 0, cursor: "pointer", padding: 0, font: "inherit" }}
                  aria-expanded={expanded === task.taskId}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.goal}</span>
                    <span style={{ fontSize: 11, color: statusColor[task.status], flexShrink: 0 }}>{task.status}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#8a8a82", marginTop: 4 }}>
                    {task.executionMode ?? "automatic"} · {new Date(task.createdAt).toLocaleString()}
                  </div>
                </button>
                {expanded === task.taskId ? (
                  <div style={{ marginTop: 10, borderTop: "1px solid #eaeae4", paddingTop: 10 }}>
                    {task.result?.summary ? (
                      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "#55554e" }}>
                        <strong>{S.summary}：</strong>
                        {String(task.result.summary).slice(0, 500)}
                      </p>
                    ) : null}
                    {task.error ? (
                      <p style={{ margin: "6px 0 0", fontSize: 12, color: "#b3261e" }}>
                        <strong>{S.error}：</strong>
                        {task.error.slice(0, 300)}
                      </p>
                    ) : null}
                    {task.result?.screenshotAsset ? (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 11, color: "#8a8a82", marginBottom: 4 }}>{S.screenshot}</div>
                        <img src={task.result.screenshotAsset.url} alt={S.screenshot} style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid #e2e2dc" }} />
                      </div>
                    ) : null}
                    {task.result?.recordingAsset ? (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 11, color: "#8a8a82", marginBottom: 4 }}>{S.recording}</div>
                        <video src={task.result.recordingAsset.url} controls style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid #e2e2dc" }} />
                      </div>
                    ) : null}
                    <div style={{ fontSize: 11, color: "#8a8a82", margin: "10px 0 4px" }}>{S.events}</div>
                    <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                      {task.events.slice(0, 20).map((event, index) => (
                        <li key={index} style={{ fontSize: 11, color: "#55554e", display: "flex", gap: 8 }}>
                          <span style={{ color: "#a0a098", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                            {new Date(event.createdAt).toLocaleTimeString()}
                          </span>
                          <span style={{ flexShrink: 0, fontWeight: 600 }}>{event.eventType}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {event.detail ?? ""}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default DesktopAgentHistoryPanel;
