import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ChatMessage, ChatMessageCreateRequest, ChatSessionSummary, ContentBlock } from "@helstera/shared";
import type { AuthenticatedUser } from "../auth/types.js";
import { ChatServiceError, toIsoTimestamp, type ChatService } from "../features/chat/chat-service.js";

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
    async listMessages(
      user: AuthenticatedUser,
      sessionId: string,
      options?: MessageListOptions,
    ) {
      await assertSessionAccess(db, sessionId, user.id);
      // Long sessions must not be loaded in full: fetch the newest `limit`
      // messages (hard-capped) and return them in ascending order so existing
      // callers keep receiving a chronological list.
      const limit = resolveMessageLimit(options?.limit);
      const { rows } = await db.query(
        `select * from (
           select ${messageColumns} from chat_messages where session_id = $1 order by created_at desc, id desc limit $2
         ) recent order by created_at asc, id asc`,
        [sessionId, limit],
      );
      const messages = rows.map(mapMessage);
      return messages.filter((message, index) =>
        index === 0 ||
        message.role !== messages[index - 1]!.role ||
        message.content !== messages[index - 1]!.content,
      );
    },
    async createMessage(user, sessionId, input: ChatMessageCreateRequest) {
      await assertSessionAccess(db, sessionId, user.id);
      if (input.clientMessageId) {
        const existing = await db.query(`select ${messageColumns} from chat_messages where session_id = $1 and client_message_id = $2`, [sessionId, input.clientMessageId]);
        if (existing.rows[0]) return mapMessage(existing.rows[0]);
      }
      const { rows } = await db.query(
        `insert into chat_messages (session_id, role, content, tool_activities, content_blocks, client_message_id) values ($1, $2, $3, $4, $5, $6) on conflict do nothing returning ${messageColumns}`,
        [sessionId, input.role, input.content, toJson(input.toolActivities), toJson(input.contentBlocks), input.clientMessageId ?? null],
      );
      if (!rows[0] && input.clientMessageId) {
        const replay = await db.query(`select ${messageColumns} from chat_messages where session_id = $1 and client_message_id = $2`, [sessionId, input.clientMessageId]);
        if (replay.rows[0]) return mapMessage(replay.rows[0]);
      }
      if (!rows[0]) throw new ChatServiceError("chat_error", "Failed to save message.", 500);
      await db.query("update chat_sessions set updated_at = now() where id = $1", [sessionId]);
      return mapMessage(rows[0]);
    },
  };
}

const messageColumns = "id, role, content, tool_activities, content_blocks, created_at";

/** Optional page window for `listMessages`; callers may omit it entirely. */
export type MessageListOptions = { limit?: number };

/** Newest-message cap applied when the caller does not ask for a page size. */
export const DEFAULT_MESSAGE_LIMIT = 300;
/** Absolute upper bound so a caller cannot request a full long-session load. */
export const MAX_MESSAGE_LIMIT = 500;

export function resolveMessageLimit(requested?: number): number {
  if (requested == null || !Number.isFinite(requested)) return DEFAULT_MESSAGE_LIMIT;
  return Math.min(Math.max(1, Math.trunc(requested)), MAX_MESSAGE_LIMIT);
}

function toJson(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
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
  return { id: row.id, role: row.role, content: row.content, toolActivities: row.tool_activities as ChatMessage["toolActivities"], contentBlocks: blocks, createdAt: toIsoTimestamp(row.created_at) };
}
