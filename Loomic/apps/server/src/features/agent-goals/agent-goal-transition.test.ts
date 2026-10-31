import { describe, expect, it, vi } from "vitest";

import { AgentGoalService } from "./agent-goal-service.js";

describe("AgentGoalService transitions", () => {
  it.each([
    ["retry", "completed"],
    ["pause", "failed"],
    ["resume", "completed"],
    ["cancel", "completed"],
  ] as const)("rejects %s from terminal status %s", async (transition, status) => {
    const query = vi.fn().mockResolvedValue({ rows: [{ status }] });
    const service = new AgentGoalService({ query } as never);

    await expect(service.transition("user-1", "workspace-1", "goal-1", transition)).rejects.toThrow(
      `Agent goal cannot ${transition} from status ${status}.`,
    );
    expect(query).toHaveBeenCalledOnce();
  });

  it("uses an expected status in the update so concurrent retries cannot both reopen a goal", async () => {
    let statusReads = 0;
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.startsWith("select status from agent_goals")) {
        statusReads += 1;
        return { rows: [{ status: statusReads === 1 ? "failed" : "running" }] };
      }
      if (sql.includes("update agent_goals") && sql.includes("and status=$6")) return { rows: [] };
      if (sql.includes("select id,workspace_id,created_by,canvas_id")) {
        return {
          rows: [{
            id: "goal-1",
            workspace_id: "workspace-1",
            created_by: "user-1",
            canvas_id: null,
            chat_session_id: null,
            goal: "Retry this goal",
            status: "running",
            plan: { steps: [], generatedAt: "2026-10-31T00:00:00.000Z" },
            execution_mode: "automatic",
            capabilities: [],
            result: null,
            error_message: null,
            created_at: "2026-10-31T00:00:00.000Z",
            updated_at: "2026-10-31T00:00:00.000Z",
            completed_at: null,
          }],
        };
      }
      return { rows: [] };
    });
    const service = new AgentGoalService({ query } as never);

    await expect(service.transition("user-1", "workspace-1", "goal-1", "retry")).resolves.toBeDefined();
    expect(query.mock.calls[1]?.[0]).toContain("and status=$6");
    expect(query.mock.calls[1]?.[1]).toEqual(["goal-1", "user-1", "workspace-1", "running", false, "failed"]);
  });
});
