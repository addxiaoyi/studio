import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";

import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import { acceptSuggestion, SuggestionUnavailableError } from "../features/agent-goals/agent-suggestion-service.js";
import { validateMemoryPreference } from "../features/agent-goals/agent-memory-policy.js";

type MemoryRouteOptions = {
  db: Pool;
  auth: RequestAuthenticator;
  viewerService: ViewerService;
};

function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "Authentication required." } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function iso(value: string | Date | null | undefined) {
  return value ? new Date(value).toISOString() : null;
}

function mapMemory(row: Record<string, unknown>) {
  return {
    id: row.id,
    kind: row.kind,
    key: row.key,
    value: row.value,
    ...(typeof row.source === "string" ? { source: row.source } : {}),
    confidence: Number(row.confidence),
    enabled: row.enabled === true,
    lastUsedAt: iso(row.last_used_at as string | Date | null),
    expiresAt: iso(row.expires_at as string | Date | null),
    createdAt: iso(row.created_at as string | Date)!,
    updatedAt: iso(row.updated_at as string | Date)!,
  };
}

function mapSuggestion(row: Record<string, unknown>) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    ...(typeof row.goal === "string" ? { goal: row.goal } : {}),
    sourceMemoryIds: Array.isArray(row.source_memory_ids) ? row.source_memory_ids : [],
    status: row.status,
    createdAt: iso(row.created_at as string | Date)!,
    expiresAt: iso(row.expires_at as string | Date | null),
  };
}

export function registerAgentMemoryRoutes(app: FastifyInstance, options: MemoryRouteOptions) {

  app.get("/api/agent/memories", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    const viewer = await options.viewerService.ensureViewer(user);
    const { rows } = await options.db.query(
      `select id,kind,key,value,source,confidence,enabled,last_used_at,expires_at,created_at,updated_at
         from agent_memories
        where workspace_id=$1 and user_id=$2 and (expires_at is null or expires_at > now())
        order by updated_at desc limit 100`,
      [viewer.workspace.id, user.id],
    );
    return { ok: true, data: rows.map(mapMemory) };
  });

  app.patch<{ Params: { memoryId: string } }>("/api/agent/memories/:memoryId", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    const viewer = await options.viewerService.ensureViewer(user);
    const body = isRecord(request.body) ? request.body : {};
    const value = typeof body.value === "string" ? body.value.trim() : undefined;
    const enabled = typeof body.enabled === "boolean" ? body.enabled : undefined;
    if ((body.value !== undefined && (typeof body.value !== "string" || !value || value.length > 2_000)) ||
        (body.enabled !== undefined && typeof body.enabled !== "boolean")) {
      return reply.code(400).send({ ok: false, error: { code: "memory_update_invalid", message: "Provide a valid preference value or boolean enabled state." } });
    }
    if (!value && enabled === undefined) return reply.code(400).send({ ok: false, error: { code: "memory_update_invalid", message: "Provide a memory value or enabled state." } });
    if (value !== undefined) {
      const memory = await options.db.query<{ key: string }>(
        "select key from agent_memories where id=$1 and workspace_id=$2 and user_id=$3",
        [request.params.memoryId, viewer.workspace.id, user.id],
      );
      if (!memory.rows[0]) return reply.code(404).send({ ok: false, error: { code: "memory_not_found", message: "Memory not found." } });
      if (!validateMemoryPreference(memory.rows[0].key, value)) {
        return reply.code(400).send({ ok: false, error: { code: "memory_value_invalid", message: "Only supported structured preference values can be saved. Do not store credentials." } });
      }
    }
    const { rows } = await options.db.query(
      `update agent_memories
          set value=coalesce($4,value), enabled=coalesce($5,enabled), updated_at=now()
        where id=$1 and workspace_id=$2 and user_id=$3
        returning id,kind,key,value,source,confidence,enabled,last_used_at,expires_at,created_at,updated_at`,
      [request.params.memoryId, viewer.workspace.id, user.id, value ?? null, enabled ?? null],
    );
    if (!rows[0]) return reply.code(404).send({ ok: false, error: { code: "memory_not_found", message: "Memory not found." } });
    return { ok: true, data: mapMemory(rows[0]) };
  });

  app.delete<{ Params: { memoryId: string } }>("/api/agent/memories/:memoryId", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    const viewer = await options.viewerService.ensureViewer(user);
    const deleted = await options.db.query(
      "delete from agent_memories where id=$1 and workspace_id=$2 and user_id=$3 returning id",
      [request.params.memoryId, viewer.workspace.id, user.id],
    );
    if (!deleted.rows[0]) return reply.code(404).send({ ok: false, error: { code: "memory_not_found", message: "Memory not found." } });
    return { ok: true, data: { id: deleted.rows[0].id } };
  });

  app.get("/api/agent/suggestions", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    const viewer = await options.viewerService.ensureViewer(user);
    const { rows } = await options.db.query(
      `select id,kind,title,detail,goal,source_memory_ids,status,created_at,expires_at
         from agent_suggestions
        where workspace_id=$1 and user_id=$2 and status='pending'
          and (expires_at is null or expires_at > now())
        order by created_at desc limit 20`,
      [viewer.workspace.id, user.id],
    );
    return { ok: true, data: rows.map(mapSuggestion) };
  });

  app.post<{ Params: { suggestionId: string } }>("/api/agent/suggestions/:suggestionId/dismiss", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    const viewer = await options.viewerService.ensureViewer(user);
    const { rows } = await options.db.query(
      `update agent_suggestions set status='dismissed',updated_at=now()
        where id=$1 and workspace_id=$2 and user_id=$3 and status='pending'
        returning id,kind,title,detail,goal,source_memory_ids,status,created_at,expires_at`,
      [request.params.suggestionId, viewer.workspace.id, user.id],
    );
    if (!rows[0]) return reply.code(404).send({ ok: false, error: { code: "suggestion_not_found", message: "Suggestion not found." } });
    return { ok: true, data: mapSuggestion(rows[0]) };
  });

  app.post<{ Params: { suggestionId: string } }>("/api/agent/suggestions/:suggestionId/accept", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    const viewer = await options.viewerService.ensureViewer(user);
    try {
      const accepted = await acceptSuggestion(options.db, user.id, viewer.workspace.id, request.params.suggestionId);
      return { ok: true, data: accepted };
    } catch (error) {
      if (error instanceof SuggestionUnavailableError) {
        return reply.code(404).send({ ok: false, error: { code: "suggestion_not_found", message: error.message } });
      }
      request.log.error({ err: error }, "Agent suggestion acceptance failed");
      return reply.code(500).send({ ok: false, error: { code: "suggestion_accept_failed", message: "Unable to prepare the goal. Please retry." } });
    }
  });
}
