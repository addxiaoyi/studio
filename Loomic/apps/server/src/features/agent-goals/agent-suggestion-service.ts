import type { Pool } from "pg";
import { agentGoalCreateRequestSchema, type AgentGoalCreateRequest } from "@helstera/shared";
import { AgentGoalService } from "./agent-goal-service.js";

type SuggestionRow = {
  id: string;
  status: string;
  expired: boolean;
  goal: string | null;
  canvas_id: string | null;
  chat_session_id: string | null;
  source_memory_ids: string[];
  execution_mode: AgentGoalCreateRequest["executionMode"];
  output_kind: AgentGoalCreateRequest["outputKind"];
};

export class SuggestionUnavailableError extends Error {
  constructor() {
    super("Suggestion is unavailable or has expired.");
  }
}

export async function acceptSuggestion(db: Pool, userId: string, workspaceId: string, suggestionId: string) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<SuggestionRow>(
      `select id,status,goal,canvas_id,chat_session_id,source_memory_ids,execution_mode,output_kind,
              (expires_at is not null and expires_at <= now()) as expired
         from agent_suggestions where id=$1 and workspace_id=$2 and user_id=$3 for update`,
      [suggestionId, workspaceId, userId],
    );
    const suggestion = rows[0];
    if (!suggestion || !["pending", "accepted"].includes(suggestion.status)) throw new SuggestionUnavailableError();

    const goals = new AgentGoalService(client);
    if (suggestion.status === "accepted") {
      const existing = await client.query<{ id: string }>(
        "select id from agent_goals where workspace_id=$1 and created_by=$2 and idempotency_key=$3",
        [workspaceId, userId, `suggestion:${suggestion.id}`],
      );
      if (!existing.rows[0]) throw new SuggestionUnavailableError();
      const goal = await goals.get(userId, workspaceId, existing.rows[0].id);
      await client.query("commit");
      return { suggestionId: suggestion.id, goal };
    }
    if (suggestion.expired || !suggestion.goal?.trim()) throw new SuggestionUnavailableError();

    const memories = await client.query<{ id: string }>(
      `select id from agent_memories where id=any($1::uuid[]) and workspace_id=$2 and user_id=$3
         and enabled=true and (expires_at is null or expires_at > now())`,
      [suggestion.source_memory_ids, workspaceId, userId],
    );
    const goal = await goals.create(userId, workspaceId, agentGoalCreateRequestSchema.parse({
      goal: suggestion.goal,
      ...(suggestion.canvas_id ? { canvasId: suggestion.canvas_id } : {}),
      ...(suggestion.chat_session_id ? { chatSessionId: suggestion.chat_session_id } : {}),
      executionMode: suggestion.execution_mode,
      outputKind: suggestion.output_kind,
      memoryContextIds: memories.rows.map((memory) => memory.id),
      source: "suggestion",
      executionPolicy: "approval_required",
      idempotencyKey: `suggestion:${suggestion.id}`,
    }));
    await client.query("update agent_suggestions set status='accepted',updated_at=now() where id=$1", [suggestion.id]);
    await client.query("commit");
    return { suggestionId: suggestion.id, goal };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
