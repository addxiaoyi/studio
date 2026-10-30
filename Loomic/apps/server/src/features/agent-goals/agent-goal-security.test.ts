import { describe, expect, it, vi } from "vitest";

import { AgentGoalService } from "./agent-goal-service.js";

describe("AgentGoalService context isolation", () => {
  it("requires a chat session to belong to the active workspace", async () => {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("insert into agent_goals")) return { rows: [{ id: "goal-1" }] };
      if (sql.includes("from chat_sessions cs")) return { rows: [] };
      return { rows: [] };
    });
    const service = new AgentGoalService({ query } as never);

    await expect(service.create("user-1", "workspace-current", {
      goal: "Summarize the selected chat",
      chatSessionId: "00000000-0000-0000-0000-000000000001",
      executionMode: "automatic",
      capabilities: [],
      attachments: [],
      idempotencyKey: "goal-1",
    })).rejects.toThrow("Chat session is not available");

    const contextQuery = query.mock.calls.find(([sql]) => String(sql).includes("from chat_sessions cs"));
    expect(contextQuery?.[0]).toContain("p.workspace_id=$4");
    expect(contextQuery?.[1]).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "user-1",
      "user-1",
      "workspace-current",
    ]);
  });
});
