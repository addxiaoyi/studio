import React from "react";

type AgentEvent = {
  taskId?: string;
  eventType?: string;
  stepId?: string;
  detail?: string;
  progress?: number;
  approvalId?: string;
  action?: { kind?: string; target?: string; requestId?: string };
};

type AgentTaskCardState = {
  taskId: string;
  status: "running" | "approval_required" | "completed" | "failed";
  progress: number;
  detail: string;
  steps: Array<{ stepId: string; detail: string; at: number }>;
  approvalId?: string;
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
    progress: "Agent task progress",
    approved: "Approved. Continuing.",
    rejected: "Rejected.",
    approve: "Approve",
    reject: "Reject",
  },
} as const;

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
  const [cards, setCards] = React.useState<Map<string, AgentTaskCardState>>(new Map());
  const [resolving, setResolving] = React.useState<string | null>(null);

  const handleResolve = React.useCallback(async (approvalId: string, decision: "approve" | "reject") => {
    setResolving(approvalId);
    try {
      const ok = await resolveApproval(approvalId, decision);
      if (ok) {
        const feedback = decision === "approve" ? STRINGS[isEnglish() ? "en" : "zh"].approved : STRINGS[isEnglish() ? "en" : "zh"].rejected;
        setCards((current) => {
          const next = new Map(current);
          for (const [taskId, card] of next) {
            if (card.approvalId === approvalId) {
              next.set(taskId, { ...card, status: "running", approvalId: undefined, detail: feedback });
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
      setCards((current) => {
        const next = new Map(current);
        const existing = next.get(event.taskId!);
        const status: AgentTaskCardState["status"] =
          event.eventType === "approval_required"
            ? "approval_required"
            : event.eventType === "completed"
              ? "completed"
              : event.eventType === "failed"
                ? "failed"
                : "running";
        const steps = [...(existing?.steps ?? [])];
        if (event.detail && (event.eventType === "step" || event.eventType === "evidence")) {
          steps.push({ stepId: event.stepId ?? "step", detail: event.detail.slice(0, 200), at: Date.now() });
          while (steps.length > MAX_STEPS) steps.shift();
        }
        next.set(event.taskId!, {
          taskId: event.taskId!,
          status,
          progress: typeof event.progress === "number" ? event.progress : existing?.progress ?? 0,
          detail: event.detail?.slice(0, 300) ?? existing?.detail ?? "",
          steps,
          approvalId: event.approvalId ?? (status === "approval_required" ? existing?.approvalId : undefined),
          updatedAt: Date.now(),
        });
        if (status === "completed" || status === "failed") {
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
    return unsubscribe;
  }, []);

  const pendingApprovalRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    pendingApprovalRef.current = [...cards.values()].find((card) => card.status === "approval_required" && card.approvalId)?.approvalId ?? null;
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
                  · {step.detail}
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
