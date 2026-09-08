import type { Pool } from "pg";
import type { AgentRunMetadataService } from "../features/agent-runs/agent-run-service.js";
import type { CreateAcceptedAgentRunInput, UpdateAgentRunInput } from "../features/agent-runs/types.js";

export function createLocalAgentRunMetadataService(db: Pool): AgentRunMetadataService {
  return {
    async createAcceptedRun(input: CreateAcceptedAgentRunInput) {
      await db.query("insert into agent_runs (id, session_id, thread_id, status, model) values ($1, $2, $3, 'accepted', $4)", [input.runId, input.sessionId, input.threadId, input.model ?? null]);
    },
    async updateRun(input: UpdateAgentRunInput) {
      await db.query("update agent_runs set status = $1, completed_at = coalesce($2, completed_at), error_code = coalesce($3, error_code), error_message = coalesce($4, error_message) where id = $5", [input.status, input.completedAt ?? null, input.errorCode ?? null, input.errorMessage ?? null, input.runId]);
    },
  };
}
