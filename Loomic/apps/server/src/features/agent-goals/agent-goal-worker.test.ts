import { describe, expect, it, vi } from "vitest";

import {
  AgentGoalWorker,
  buildGoalTaskRequest,
  DESKTOP_RETRY_COOLDOWN_SECONDS,
  extractGoalUrl,
  shouldRetryWaitingDesktop,
} from "./agent-goal-worker.js";

const goal = {
  id: "00000000-0000-4000-8000-000000000001",
  workspace_id: "00000000-0000-4000-8000-000000000002",
  created_by: "00000000-0000-4000-8000-000000000003",
  canvas_id: null,
  chat_session_id: null,
  goal: "Read https://example.com/docs and summarize it",
  status: "draft" as const,
  plan: {
    generatedAt: "2026-10-30T00:00:00.000Z",
    steps: [],
  },
  execution_mode: "automatic" as const,
  capabilities: [],
  next_attempt_at: null,
};

describe("agent goal worker planning", () => {
  it("extracts safe URLs and rejects credential URLs", () => {
    expect(extractGoalUrl("Open https://example.com/a")).toBe("https://example.com/a");
    expect(extractGoalUrl("Open https://user:pass@example.com/a")).toBeUndefined();
  });

  it("builds a read-only task for a low-risk goal", () => {
    const request = buildGoalTaskRequest(goal);
    expect(request.executionMode).toBe("automatic");
    expect(request.capabilities).toContain("browser.read");
    expect(request.plannedActions.map((action) => action.kind)).toEqual([
      "navigate",
      "read_page",
      "capture_screen",
    ]);
  });

  it("uses native observation without inventing side effects", () => {
    const request = buildGoalTaskRequest({ ...goal, execution_mode: "windows_ui", capabilities: [] });
    expect(request.capabilities).toEqual(["screen.read", "window.focus"]);
    expect(request.plannedActions).toEqual([]);
  });

  it("waits for the desktop retry cooldown before polling again", () => {
    const now = Date.parse("2026-10-30T12:00:00.000Z");
    const justBeforeRetry = new Date(now + DESKTOP_RETRY_COOLDOWN_SECONDS * 1_000 + 1);
    const readyToRetry = new Date(now);

    expect(shouldRetryWaitingDesktop(justBeforeRetry, now)).toBe(false);
    expect(shouldRetryWaitingDesktop(readyToRetry, now)).toBe(true);
    expect(shouldRetryWaitingDesktop(new Date(now - 1), now)).toBe(true);
    expect(shouldRetryWaitingDesktop(null, now)).toBe(true);
    expect(shouldRetryWaitingDesktop("invalid", now)).toBe(false);
  });

  it("does not append another waiting event while a disconnected goal is backing off", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ ...goal, status: "waiting_desktop", execution_mode: "windows_ui", next_attempt_at: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: goal.id, status: "waiting_desktop" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const db = { query } as never;
    const dispatcher = {
      createDesktopAgentTask: vi.fn().mockRejectedValue(new Error("本地桌面助手未连接。")),
    };
    const worker = new AgentGoalWorker(db, dispatcher, 60_000);

    await worker.tick();

    expect(dispatcher.createDesktopAgentTask).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("insert into agent_goal_events"),
      expect.anything(),
    );
  });

  it("recreates a task after a failed goal retry transitions back to running", async () => {
    let latestTaskReads = 0;
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("from agent_goals") && sql.includes("where status in")) {
        return { rows: [{ ...goal, status: "running" }] };
      }
      if (sql.includes("from desktop_agent_tasks") && sql.includes("order by created_at desc")) {
        latestTaskReads += 1;
        return {
          rows: [latestTaskReads === 1
            ? { id: "old-task", status: "failed", result: null, error_message: "temporary failure" }
            : { id: "new-task", status: "succeeded", result: { summary: "retried" }, error_message: null }],
        };
      }
      if (sql.includes("update agent_goals") && sql.includes("status=case")) return { rows: [{ id: goal.id, status: "running" }] };
      if (sql.includes("update desktop_agent_tasks") && sql.includes("status='succeeded'")) return { rows: [] };
      if (sql.includes("insert into desktop_agent_tasks")) return { rows: [] };
      return { rows: [] };
    });
    const backgroundExecutor = vi.fn().mockResolvedValue({ summary: "retried" });
    const worker = new AgentGoalWorker({ query } as never, {} as never, 60_000, backgroundExecutor);

    await worker.tick();

    expect(backgroundExecutor).toHaveBeenCalledOnce();
    const claim = query.mock.calls.find(([sql]) => String(sql).includes("or ($3::boolean and status='running'"));
    expect(claim?.[1]).toEqual([goal.id, DESKTOP_RETRY_COOLDOWN_SECONDS, true]);
  });
});
