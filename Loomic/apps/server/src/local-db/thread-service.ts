import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AuthenticatedUser } from "../supabase/user.js";
import { ThreadServiceError, type ThreadService } from "../features/chat/thread-service.js";

export function createLocalThreadService(db: Pool): ThreadService {
  return {
    createThreadId() { return `thread_${randomUUID()}`; },
    async resolveOwnedSessionThread(user: AuthenticatedUser, sessionId: string) {
      const { rows } = await db.query(
        `select cs.id, cs.thread_id from chat_sessions cs
         join canvases c on c.id = cs.canvas_id
         join projects p on p.id = c.project_id
         join workspace_members wm on wm.workspace_id = p.workspace_id
         where cs.id = $1 and wm.user_id = $2`,
        [sessionId, user.id],
      );
      const row = rows[0];
      if (!row) throw new ThreadServiceError("Session not found.", 404);
      if (!row.thread_id) throw new ThreadServiceError("Session is not resumable because no thread is bound yet.", 409);
      return { sessionId: row.id, threadId: row.thread_id };
    },
  };
}
