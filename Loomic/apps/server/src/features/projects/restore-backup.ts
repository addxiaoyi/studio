import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { backupAssetIds, replaceBackupAssets, type ProjectBackup, type BackupRestoreResult } from "@helstera/shared";

export class BackupRestoreError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}
function restoreId(account: string, snapshot: ProjectBackup, replacements: Record<string, string>) {
  const digest = createHash("sha256").update(account).update(JSON.stringify(snapshot));
  // A new upload after cloud release needs a new restored canvas; retries of that upload stay idempotent.
  if (Object.keys(replacements).length) digest.update(JSON.stringify(Object.entries(replacements).sort(([a], [b]) => a.localeCompare(b))));
  const hash = digest.digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function restoreProjectBackup(db: Pool, userId: string, workspaceId: string, snapshot: ProjectBackup, replacements: Record<string, string>): Promise<BackupRestoreResult> {
  if (snapshot.project.workspace?.ownerUserId && snapshot.project.workspace.ownerUserId !== userId) throw new BackupRestoreError("请登录创建此快照的账户后恢复。", 403);
  const originalIds = backupAssetIds(snapshot);
  if (Object.keys(replacements).some(id => !originalIds.includes(id))) throw new BackupRestoreError("素材替换不属于所选快照。");
  const projectId = restoreId(userId, snapshot, replacements);
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`backup:${projectId}`]);
    const existing = await client.query("select p.archived_at,c.id as canvas_id,(select id from chat_sessions where canvas_id=c.id order by created_at,id limit 1) as session_id from projects p join canvases c on c.project_id=p.id and c.is_primary where p.id=$1 and p.created_by=$2 and p.workspace_id=$3", [projectId, userId, workspaceId]);
    if (existing.rows[0]) {
      if (existing.rows[0].archived_at) throw new BackupRestoreError("此快照已恢复到归档工程，请先在项目回收站恢复工程。", 409);
      await client.query("commit");
      return { projectId, canvasId: existing.rows[0].canvas_id, sessionId: existing.rows[0].session_id, restored: false };
    }
    const remapped = replaceBackupAssets(snapshot, replacements);
    const assetIds = backupAssetIds(remapped);
    if (assetIds.length) {
      const owned = await client.query(`select ao.id from asset_objects ao where ao.id=any($1::uuid[]) and ao.workspace_id=$2
        and (ao.bucket not in ('private-video','private-try-on') or ao.created_by=$3)
        and not exists(select 1 from generated_assets ga where ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path
          and (ga.deleted_at is not null or ga.retention_state <> 'active' or ga.retention_until <= now()))`, [assetIds, workspaceId, userId]);
      if (owned.rows.length !== assetIds.length) throw new BackupRestoreError("部分素材已过期或无权访问，请从本地完整副本恢复后重试。", 409);
    }
    await client.query("insert into projects(id,workspace_id,created_by,name,slug,description,source) values($1,$2,$3,$4,$5,$6,'import')", [projectId, workspaceId, userId, `${snapshot.project.name} · 本地恢复`.slice(0, 200), `backup-${projectId}`, "从本地快照恢复；历史工具操作不会重新执行。"]);
    const canvasId = randomUUID();
    const content = remapped.canvas.content;
    // An imported drawing must not poll or retry jobs belonging to the original project.
    for (const element of content.elements) {
      const custom = element.customData as Record<string, unknown> | undefined;
      if (custom) { delete custom.goalId; delete custom.captureTaskId; delete custom.generationApprovalId; }
    }
    await client.query("insert into canvases(id,project_id,created_by,name,is_primary,content) values($1,$2,$3,$4,true,$5::jsonb)", [canvasId, projectId, userId, remapped.canvas.name || "恢复画布", JSON.stringify(content)]);
    let firstSession: string | null = null;
    for (const session of remapped.sessions) {
      const sessionId = randomUUID(); firstSession ??= sessionId;
      await client.query("insert into chat_sessions(id,canvas_id,created_by,thread_id,title) values($1,$2,$3,$4,$5)", [sessionId, canvasId, userId, randomUUID(), session.title || "恢复的对话"]);
      for (const [index, message] of session.messages.entries()) {
        const blocks = (message.contentBlocks ?? []).map(block => block.type === "tool"
          ? { type: "text", text: `[历史操作] ${block.toolName}：${block.outputSummary || block.status}` } : block);
        await client.query("insert into chat_messages(session_id,role,content,content_blocks,client_message_id,created_at) values($1,$2,$3,$4::jsonb,$5,$6)", [sessionId, message.role, message.content, JSON.stringify(blocks), `backup:${index}`, message.createdAt]);
      }
    }
    await client.query("commit");
    return { projectId, canvasId, sessionId: firstSession, restored: true };
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
