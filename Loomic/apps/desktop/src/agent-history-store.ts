const STORAGE_KEY = "helstera.desktop-agent-history.v1";
const MAX_TASKS = 100;
const MAX_EVENTS_PER_TASK = 80;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type LocalAgentEvent = {
  eventType: string;
  detail: string;
  createdAt: string;
};

export type LocalAgentTask = {
  taskId: string;
  goal: string;
  executionMode?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  createdAt: string;
  updatedAt: string;
  canvasId?: string;
  error: string | null;
  result: { summary?: string; localAssetPath?: string } | null;
  events: LocalAgentEvent[];
};

function statusFor(eventType: string, current: LocalAgentTask["status"]): LocalAgentTask["status"] {
  if (eventType === "approval_required" || eventType === "deadline_warning") return "running";
  if (eventType === "completed") return "succeeded";
  if (eventType === "canceled") return "canceled";
  if (["failed", "approval_expired"].includes(eventType)) return "failed";
  return current;
}

function safeDetail(eventType: string, detail: unknown) {
  if (["evidence", "page", "progress"].includes(eventType)) return eventType;
  if (typeof detail !== "string") return eventType;
  return detail
    .replace(/(password|passwd|otp|token|secret|cookie|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[hidden]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[hidden key]")
    .slice(0, 500);
}

export function readLocalAgentHistory(storage: Pick<Storage, "getItem">): LocalAgentTask[] {
  const serialized = storage.getItem(STORAGE_KEY);
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - RETENTION_MS;
    return parsed
      .filter((task): task is LocalAgentTask => Boolean(task && typeof task === "object" && typeof (task as LocalAgentTask).taskId === "string" && Date.parse((task as LocalAgentTask).updatedAt) >= cutoff))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, MAX_TASKS);
  } catch {
    return [];
  }
}

export function saveLocalAgentEvent(storage: Pick<Storage, "getItem" | "setItem">, event: Record<string, unknown>) {
  if (typeof event.taskId !== "string" || typeof event.eventType !== "string") return;
  const tasks = readLocalAgentHistory(storage);
  const existing = tasks.find((task) => task.taskId === event.taskId);
  const now = new Date().toISOString();
  const eventRecord: LocalAgentEvent = {
    eventType: event.eventType,
    detail: safeDetail(event.eventType, event.detail),
    createdAt: now,
  };
  const eventResult = event.result && typeof event.result === "object"
    ? event.result as Record<string, unknown>
    : {};
  const result = {
    ...(existing?.result ?? {}),
    ...(typeof eventResult.summary === "string" ? { summary: eventResult.summary.slice(0, 8_000) } : {}),
    ...(typeof event.localAssetPath === "string" ? { localAssetPath: event.localAssetPath.slice(0, 1_000) } : {}),
  };
  const task: LocalAgentTask = {
    taskId: event.taskId,
    goal: typeof event.goal === "string" ? event.goal.slice(0, 500) : existing?.goal ?? "Desktop Agent task",
    ...(typeof event.executionMode === "string" ? { executionMode: event.executionMode } : existing?.executionMode ? { executionMode: existing.executionMode } : {}),
    status: statusFor(event.eventType, existing?.status ?? "running"),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(typeof event.canvasId === "string" ? { canvasId: event.canvasId } : existing?.canvasId ? { canvasId: existing.canvasId } : {}),
    error: ["failed", "canceled", "approval_expired"].includes(event.eventType) ? eventRecord.detail : existing?.error ?? null,
    result: Object.keys(result).length ? result : null,
    events: [...(existing?.events ?? []), eventRecord].slice(-MAX_EVENTS_PER_TASK),
  };
  const next = [task, ...tasks.filter((item) => item.taskId !== event.taskId)].slice(0, MAX_TASKS);
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
}
