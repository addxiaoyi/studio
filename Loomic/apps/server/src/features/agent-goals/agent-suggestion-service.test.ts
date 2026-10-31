import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentGoalService } from "./agent-goal-service.js";
import { acceptSuggestion, SuggestionUnavailableError } from "./agent-suggestion-service.js";

const suggestion = {
  id: "suggestion", status: "pending", expired: false, goal: "Prepare a document",
  canvas_id: null, chat_session_id: null, source_memory_ids: [],
  execution_mode: "windows_ui", output_kind: "document",
};

function database(row: unknown = suggestion) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("for update")) return { rows: row ? [row] : [] };
    if (sql.includes("from agent_goals")) return { rows: [{ id: "existing-goal" }] };
    return { rows: [] };
  });
  const release = vi.fn();
  return { query, release, connect: vi.fn().mockResolvedValue({ query, release }) };
}

afterEach(() => vi.restoreAllMocks());

describe("suggestion acceptance", () => {
  it("creates a confirmation-required goal preserving execution preferences before accepting", async () => {
    const db = database();
    const create = vi.spyOn(AgentGoalService.prototype, "create").mockResolvedValue({ id: "goal", status: "draft" } as never);
    const accepted = await acceptSuggestion(db as never, "user", "workspace", "suggestion");
    expect(accepted.goal.status).toBe("draft");
    expect(create).toHaveBeenCalledWith("user", "workspace", expect.objectContaining({
      executionMode: "windows_ui", outputKind: "document", executionPolicy: "approval_required", source: "suggestion",
    }));
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("for update"), ["suggestion", "workspace", "user"]);
    expect(db.query).toHaveBeenLastCalledWith("commit");
    expect(db.release).toHaveBeenCalledOnce();
  });

  it("rolls back rather than consuming a suggestion when goal creation fails", async () => {
    const db = database();
    vi.spyOn(AgentGoalService.prototype, "create").mockRejectedValue(new Error("database failure"));
    await expect(acceptSuggestion(db as never, "user", "workspace", "suggestion")).rejects.toThrow("database failure");
    expect(db.query).toHaveBeenLastCalledWith("rollback");
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining("update agent_suggestions"), expect.anything());
    expect(db.release).toHaveBeenCalledOnce();
  });

  it.each([null, { ...suggestion, expired: true }, { ...suggestion, status: "dismissed" }])("does not accept unavailable suggestions", async (row) => {
    const db = database(row);
    const create = vi.spyOn(AgentGoalService.prototype, "create");
    await expect(acceptSuggestion(db as never, "user", "workspace", "suggestion")).rejects.toBeInstanceOf(SuggestionUnavailableError);
    expect(create).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenLastCalledWith("rollback");
  });

  it("returns the same goal on retry even after the suggestion expires", async () => {
    const db = database({ ...suggestion, status: "accepted", expired: true });
    const get = vi.spyOn(AgentGoalService.prototype, "get").mockResolvedValue({ id: "existing-goal" } as never);
    const create = vi.spyOn(AgentGoalService.prototype, "create");
    const accepted = await acceptSuggestion(db as never, "user", "workspace", "suggestion");
    expect(accepted.goal.id).toBe("existing-goal");
    expect(get).toHaveBeenCalledWith("user", "workspace", "existing-goal");
    expect(create).not.toHaveBeenCalled();
  });
});
