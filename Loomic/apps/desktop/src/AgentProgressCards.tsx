import React from "react";
import { saveLocalAgentEvent } from "./agent-history-store.js";

type AgentEvent = {
  taskId?: string;
  eventType?: string;
  stepId?: string;
  detail?: string;
  progress?: number;
  approvalId?: string;
  expiresAt?: string;
  canvasId?: string;
  action?: { kind?: string; target?: string; requestId?: string };
};

type AgentTaskCardState = {
  taskId: string;
  status: "running" | "approval_required" | "completed" | "failed" | "canceled";
  progress: number;
  detail: string;
  steps: Array<{ stepId: string; label: string; detail: string; at: number }>;
  approvalId?: string;
  expiresAt?: string;
  canvasId?: string;
  updatedAt: number;
};

const TASK_TTL_MS = 60_000;
const MAX_STEPS = 8;

const isEnglish = () => {
  if (typeof document === "undefined") return true;
  const lang = document.documentElement?.lang ?? navigator.language ?? "zh-CN";
  return !lang.toLowerCase().startsWith("zh");
};

const STRINGS = {
  zh: {
    canceled: "任务已取消",
    running: "Agent 执行中",
    approval: "等待你的批准",
    completed: "任务完成",
    failed: "任务失败",
    progress: "Agent 任务进度",
    approved: "已批准，继续执行。",
    rejected: "已拒绝该操作。",
    approve: "批准",
    reject: "拒绝",
  },
  en: {
    running: "Agent running",
    approval: "Awaiting your approval",
    completed: "Task completed",
    failed: "Task failed",
    canceled: "Task canceled",
    progress: "Agent task progress",
    approved: "Approved. Continuing.",
    rejected: "Rejected.",
    approve: "Approve",
    reject: "Reject",
  },
} as const;

const EXTRA_STRINGS = {
  zh: {
    expired: "审批已过期，操作未执行。",
    canvas: "在画布中查看",
    grounding: "视觉定位",
    reobserve: "重新观察并规划",
    deadline: "时间将到，正在完成当前动作并保存证据。",
  },
  en: {
    expired: "Approval expired; the action was not run.",
    canvas: "Open in canvas",
    grounding: "Visual grounding",
    reobserve: "Re-observing and planning",
    deadline: "Time limit reached. Finishing the current action and saving evidence.",
  },
} as const;

export function labelEvent(event: AgentEvent) {
  const english = isEnglish();
  const text = EXTRA_STRINGS[english ? "en" : "zh"];
  if (event.eventType === "deadline_warning") return text.deadline;
  if (event.eventType === "approval_expired") return text.expired;
  if (event.eventType === "visual_grounding") return text.grounding;
  if (event.stepId === "reobserve") {
    const round = event.detail?.match(/(?:round\s+|第\s*)(\d+)(?:\s*轮)?/i)?.[1];
    return round ? english ? `Round ${round}: observe and re-plan` : `第 ${round} 轮：重新观察并规划` : text.reobserve;
  }
  return event.detail ?? "";
}

async function resolveApproval(approvalId: string, decision: "approve" | "reject"): Promise<boolean> {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  try {
    const response = await fetch(
      `${base}/api/website-capture/assistant/desktop-approvals/${encodeURIComponent(approvalId)}/${decision}`,
      { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export function DesktopAgentProgressCards() {
  const S = STRINGS[isEnglish() ? "en" : "zh"];
  const extra = EXTRA_STRINGS[isEnglish() ? "en" : "zh"];
  const [cards, setCards] = React.useState<Map<string, AgentTaskCardState>>(new Map());
  const [resolving, setResolving] = React.useState<string | null>(null);
  const approvalTimers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const handleResolve = React.useCallback(async (approvalId: string, decision: "approve" | "reject") => {
    setResolving(approvalId);
    try {
      const ok = await resolveApproval(approvalId, decision);
      if (ok) {
        const timer = approvalTimers.current.get(approvalId);
        if (timer) clearTimeout(timer);
        approvalTimers.current.delete(approvalId);
        const feedback = decision === "approve" ? STRINGS[isEnglish() ? "en" : "zh"].approved : STRINGS[isEnglish() ? "en" : "zh"].rejected;
        setCards((current) => {
          const next = new Map(current);
          for (const [taskId, card] of next) {
            if (card.approvalId === approvalId) {
              next.set(taskId, { ...card, status: "running", approvalId: undefined, expiresAt: undefined, detail: feedback });
            }
          }
          return next;
        });
      }
    } finally {
      setResolving(null);
    }
  }, []);

  React.useEffect(() => {
    const api = (window as Window & { electronAPI?: { onAgentEvent?: (cb: (event: unknown) => void) => () => void } }).electronAPI;
    if (!api?.onAgentEvent) return;
    const unsubscribe = api.onAgentEvent((raw) => {
      const event = raw as AgentEvent;
      if (!event?.taskId || !event.eventType) return;
      try {
        saveLocalAgentEvent(window.localStorage, event as Record<string, unknown>);
      } catch (error) {
        console.error("[desktop-agent-history] could not persist a local event", error);
      }
      if (event.approvalId && (event.eventType === "approval_required" || event.eventType === "approval_expired")) {
        const previousTimer = approvalTimers.current.get(event.approvalId);
        if (previousTimer) clearTimeout(previousTimer);
        approvalTimers.current.delete(event.approvalId);
        if (event.eventType === "approval_required" && event.expiresAt) {
          const delay = Math.max(0, Date.parse(event.expiresAt) - Date.now());
          const timer = setTimeout(() => {
            setCards((current) => {
              const next = new Map(current);
              const card = next.get(event.taskId!);
              if (card?.approvalId === event.approvalId) next.set(event.taskId!, {
                ...card, status: "failed", approvalId: undefined, expiresAt: undefined,
                detail: EXTRA_STRINGS[isEnglish() ? "en" : "zh"].expired, updatedAt: Date.now(),
              });
              return next;
            });
            approvalTimers.current.delete(event.approvalId!);
          }, delay);
          approvalTimers.current.set(event.approvalId, timer);
        }
      }
      setCards((current) => {
        const next = new Map(current);
        const existing = next.get(event.taskId!);
        const status: AgentTaskCardState["status"] =
          event.eventType === "approval_required"
            ? "approval_required"
            : event.eventType === "approval_expired"
              ? "failed"
              : event.eventType === "canceled"
                ? "canceled"
                : event.eventType === "completed"
                  ? "completed"
                  : event.eventType === "failed"
                    ? "failed"
                    : "running";
        const steps = [...(existing?.steps ?? [])];
        if (event.detail && ["step", "evidence", "visual_grounding", "deadline_warning"].includes(event.eventType)) {
          steps.push({ stepId: event.stepId ?? event.eventType, label: labelEvent(event), detail: event.detail.slice(0, 200), at: Date.now() });
          while (steps.length > MAX_STEPS) steps.shift();
        }
        next.set(event.taskId!, {
          taskId: event.taskId!,
          status,
          progress: typeof event.progress === "number" ? event.progress : existing?.progress ?? 0,
          detail: event.detail?.slice(0, 300) ?? existing?.detail ?? "",
          steps,
          approvalId: event.approvalId ?? (status === "approval_required" ? existing?.approvalId : undefined),
          expiresAt: event.expiresAt ?? (status === "approval_required" ? existing?.expiresAt : undefined),
          canvasId: event.canvasId ?? existing?.canvasId,
          updatedAt: Date.now(),
        });
        if (status === "completed" || status === "failed" || status === "canceled") {
          const taskId = event.taskId!;
          window.setTimeout(() => {
            setCards((latest) => {
              const cleaned = new Map(latest);
              const card = cleaned.get(taskId);
              if (card && Date.now() - card.updatedAt >= TASK_TTL_MS - 1_000) cleaned.delete(taskId);
              return cleaned;
            });
          }, TASK_TTL_MS);
        }
        return next;
      });
    });
    return () => {
      unsubscribe();
      for (const timer of approvalTimers.current.values()) clearTimeout(timer);
      approvalTimers.current.clear();
    };
  }, []);

  const pendingApprovalRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    pendingApprovalRef.current = [...cards.values()].find((card) => card.status === "approval_required" && card.approvalId && (!card.expiresAt || Date.parse(card.expiresAt) > Date.now()))?.approvalId ?? null;
  }, [cards]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const approvalId = pendingApprovalRef.current;
      if (!approvalId || resolving) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "y" || event.key === "Y") void handleResolve(approvalId, "approve");
      else if (event.key === "n" || event.key === "N") void handleResolve(approvalId, "reject");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleResolve, resolving]);

  if (cards.size === 0) return null;
  const visible = [...cards.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);

  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 9_999,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: 320,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {visible.map((card) => (
        <section
          key={card.taskId}
          aria-label={S.progress}
          style={{
            border: "1px solid #d8d8d2",
            borderRadius: 12,
            background: "rgba(255,255,255,0.97)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            padding: "12px 14px",
            color: "#191918",
          }}
        >
          <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <strong style={{ fontSize: 13 }}>
              {card.status === "running" && S.running}
              {card.status === "approval_required" && S.approval}
              {card.status === "completed" && S.completed}
              {card.status === "failed" && S.failed}
              {card.status === "canceled" && S.canceled}
            </strong>
            <span style={{ fontSize: 11, color: "#8a8a82", fontVariantNumeric: "tabular-nums" }}>{card.progress}%</span>
          </header>
          <progress
            max={100}
            value={card.progress}
            aria-label={S.progress}
            style={{ display: "block", width: "100%", height: 4, marginTop: 8, accentColor: card.status === "failed" ? "#b3261e" : "#161616" }}
          />
          {card.detail ? (
            <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.5, color: "#55554e", wordBreak: "break-word" }}>{card.detail}</p>
          ) : null}
          {card.canvasId ? (
            <button type="button" onClick={() => { window.location.hash = `/desktop-app/canvas/?id=${encodeURIComponent(card.canvasId!)}`; }} style={{ marginTop: 8, border: 0, background: "none", color: "#315f93", cursor: "pointer", fontSize: 12, textDecoration: "underline", textUnderlineOffset: 3 }}>
              {extra.canvas}
            </button>
          ) : null}
          {card.status === "approval_required" && card.approvalId ? (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                type="button"
                disabled={resolving === card.approvalId}
                aria-keyshortcuts="y"
                onClick={() => void handleResolve(card.approvalId!, "approve")}
                style={{ flex: 1, minHeight: 32, border: 0, borderRadius: 7, background: "#161616", color: "#fff", cursor: resolving === card.approvalId ? "wait" : "pointer", fontSize: 12 }}
              >
                批准
              </button>
              <button
                type="button"
                disabled={resolving === card.approvalId}
                aria-keyshortcuts="n"
                onClick={() => void handleResolve(card.approvalId!, "reject")}
                style={{ flex: 1, minHeight: 32, borderRadius: 7, border: "1px solid #d8d8d2", background: "#fff", color: "#b3261e", cursor: resolving === card.approvalId ? "wait" : "pointer", fontSize: 12 }}
              >
                拒绝
              </button>
            </div>
          ) : null}
          {card.steps.length > 0 && card.status === "running" ? (
            <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", maxHeight: 120, overflow: "hidden" }}>
              {card.steps.slice(-3).map((step, index) => (
                <li key={`${step.at}-${index}`} style={{ fontSize: 11, color: "#8a8a82", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {step.label}: {step.detail}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}

export default DesktopAgentProgressCards;
