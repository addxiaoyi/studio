import type { Pool } from "pg";
import { projectContextSchema, type ProjectContext, type ProjectContextQuery, type ProjectContextUpdate } from "@helstera/shared";

type Database = Pick<Pool, "query">;
export class ProjectContextError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export async function loadProjectContext(db: Database, userId: string, query: ProjectContextQuery): Promise<ProjectContext | null> {
  let projectId = query.projectId;
  if (!projectId && !query.canvasId) {
    const latest = await db.query<{ project_id: string }>(`select pc.project_id from project_user_contexts pc
      join projects p on p.id=pc.project_id join workspaces w on w.id=p.workspace_id
      where pc.user_id=$1 and w.owner_user_id=$1 and p.archived_at is null order by pc.updated_at desc limit 1`, [userId]);
    projectId = latest.rows[0]?.project_id;
    if (!projectId) return null;
  }
  const { rows } = await db.query(`select p.id,p.name,p.workspace_id,p.updated_at as project_updated_at,
      c.id as canvas_id,c.name as canvas_name,pc.session_id,pc.view,pc.composition_id,pc.revision,pc.updated_at
    from projects p join workspaces w on w.id=p.workspace_id
    left join project_user_contexts pc on pc.project_id=p.id and pc.user_id=$1
    join canvases c on c.project_id=p.id
    where w.owner_user_id=$1 and p.archived_at is null
      and ($2::uuid is null or p.id=$2)
      and (($3::uuid is not null and c.id=$3) or ($3::uuid is null and c.id=coalesce(pc.canvas_id,(select id from canvases where project_id=p.id and is_primary limit 1))))
    limit 1`, [userId,projectId ?? null,query.canvasId ?? null]);
  const row = rows[0];
  if (!row) throw new ProjectContextError(404, "project_context_unavailable", "工程或画布不存在、已归档，或当前账号无权访问。");
  const sessions = await db.query<{ id: string; title: string }>(`select id,title from chat_sessions
    where canvas_id=$1 and created_by=$2 and ($3::uuid is null or id=$3)
    order by (id=$4::uuid) desc nulls last,updated_at desc limit 1`, [row.canvas_id,userId,query.sessionId ?? null,row.session_id ?? null]);
  if (query.sessionId && !sessions.rows.length) throw new ProjectContextError(404, "session_context_unavailable", "对话不属于当前工程画布，无法切换。");
  return projectContextSchema.parse({
    project: { id: row.id, name: row.name, workspaceId: row.workspace_id },
    canvas: { id: row.canvas_id, name: row.canvas_name },
    session: sessions.rows[0] ?? null,
    view: row.view ?? "canvas", compositionId: row.composition_id ?? null,
    revision: Number(row.revision ?? 0), updatedAt: new Date(row.updated_at ?? row.project_updated_at).toISOString(),
  });
}

export async function saveProjectContext(db: Pool, userId: string, input: ProjectContextUpdate) {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`project-context:${userId}:${input.projectId}`]);
    const access = await client.query("select p.id from projects p join workspaces w on w.id=p.workspace_id where p.id=$1 and w.owner_user_id=$2 and p.archived_at is null for share of p,w", [input.projectId,userId]);
    if (!access.rows.length) throw new ProjectContextError(404,"project_context_unavailable","工程不存在、已归档，或当前账号无权访问。");
    const context = await loadProjectContext(client, userId, { projectId: input.projectId, canvasId: input.canvasId, ...(input.sessionId ? { sessionId: input.sessionId } : {}) });
    if (!context) throw new ProjectContextError(404, "project_context_unavailable", "工程不可用。");
    if (context.revision !== input.expectedRevision) throw new ProjectContextError(409, "project_context_changed", "其他窗口更新了工程位置；当前内容未被覆盖，请重新载入工程信息。");
    await client.query(`insert into project_user_contexts(user_id,project_id,canvas_id,session_id,view,composition_id,revision)
      values($1,$2,$3,$4,$5,$6,1) on conflict(user_id,project_id) do update set
      canvas_id=excluded.canvas_id,session_id=excluded.session_id,view=excluded.view,composition_id=excluded.composition_id,
      revision=project_user_contexts.revision+1,updated_at=clock_timestamp()`, [userId,input.projectId,input.canvasId,input.sessionId,input.view,input.compositionId]);
    const saved = await loadProjectContext(client,userId,{projectId:input.projectId,canvasId:input.canvasId,...(input.sessionId ? {sessionId:input.sessionId} : {})});
    await client.query("commit");
    return saved;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
