import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ChatMessage, ChatMessageCreateRequest, ChatSessionSummary, ContentBlock } from "@helstera/shared";
import type { AuthenticatedUser } from "../supabase/user.js";
import { ChatServiceError, type ChatService } from "../features/chat/chat-service.js";

export function createLocalChatService(db: Pool): ChatService {
  return {
    async listSessions(user, canvasId) {
      const { rows } = await db.query("select cs.id, cs.title, cs.updated_at from chat_sessions cs where cs.canvas_id = $1 and exists (select 1 from canvases c join projects p on p.id = c.project_id join workspace_members wm on wm.workspace_id = p.workspace_id where c.id = cs.canvas_id and wm.user_id = $2) order by cs.updated_at desc", [canvasId, user.id]);
      return rows.map((row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at.toISOString() }));
    },
    async createSession(user, canvasId, title) {
      await assertCanvasAccess(db, canvasId, user.id);
      const { rows } = await db.query("insert into chat_sessions (canvas_id, created_by, thread_id, title) values ($1, $2, $3, $4) returning id, title, updated_at", [canvasId, user.id, `thread_${randomUUID()}`, title?.trim() || "New Chat"]);
      return { id: rows[0].id, title: rows[0].title, updatedAt: rows[0].updated_at.toISOString() };
    },
    async updateSessionTitle(user, sessionId, title) {
      const result = await db.query("update chat_sessions cs set title = $1, updated_at = now() where cs.id = $2 and exists (select 1 from canvases c join projects p on p.id = c.project_id join workspace_members wm on wm.workspace_id = p.workspace_id where c.id = cs.canvas_id and wm.user_id = $3)", [title.trim(), sessionId, user.id]);
      if (!result.rowCount) throw new ChatServiceError("session_not_found", "Session not found.", 404);
    },
    async deleteSession(user, sessionId) {
      const result = await db.query("delete from chat_sessions cs where cs.id = $1 and exists (select 1 from canvases c join projects p on p.id = c.project_id join workspace_members wm on wm.workspace_id = p.workspace_id where c.id = cs.canvas_id and wm.user_id = $2)", [sessionId, user.id]);
      if (!result.rowCount) throw new ChatServiceError("session_not_found", "Session not found.", 404);
    },
    async listMessages(user, sessionId) {
      await assertSessionAccess(db, sessionId, user.id);
      const { rows } = await db.query("select id, role, content, tool_activities, content_blocks, created_at from chat_messages where session_id = $1 order by created_at", [sessionId]);
      return rows.map(mapMessage);
    },
    async createMessage(user, sessionId, input: ChatMessageCreateRequest) {
      await assertSessionAccess(db, sessionId, user.id);
      const { rows } = await db.query("insert into chat_messages (session_id, role, content, tool_activities, content_blocks) values ($1, $2, $3, $4, $5) returning id, role, content, tool_activities, content_blocks, created_at", [sessionId, input.role, input.content, input.toolActivities ?? null, input.contentBlocks ?? null]);
      await db.query("update chat_sessions set updated_at = now() where id = $1", [sessionId]);
      return mapMessage(rows[0]);
    },
  };
}

async function assertCanvasAccess(db: Pool, canvasId: string, userId: string) {
  const { rowCount } = await db.query("select 1 from canvases c join projects p on p.id = c.project_id join workspace_members wm on wm.workspace_id = p.workspace_id where c.id = $1 and wm.user_id = $2", [canvasId, userId]);
  if (!rowCount) throw new ChatServiceError("chat_error", "Canvas not found.", 404);
}

async function assertSessionAccess(db: Pool, sessionId: string, userId: string) {
  const { rowCount } = await db.query("select 1 from chat_sessions cs join canvases c on c.id = cs.canvas_id join projects p on p.id = c.project_id join workspace_members wm on wm.workspace_id = p.workspace_id where cs.id = $1 and wm.user_id = $2", [sessionId, userId]);
  if (!rowCount) throw new ChatServiceError("session_not_found", "Session not found.", 404);
}

function mapMessage(row: any): ChatMessage {
  const blocks = Array.isArray(row.content_blocks) ? row.content_blocks as ContentBlock[] : null;
  return { id: row.id, role: row.role, content: row.content, toolActivities: row.tool_activities as ChatMessage["toolActivities"], contentBlocks: blocks, createdAt: row.created_at.toISOString() };
}
