import type { Pool } from "pg";

export async function assertWorkflowReferenceAssets(
  db: Pick<Pool, "query">,
  scope: { workspaceId: string; userId: string },
  ids: readonly string[],
) {
  if (!ids.length) return;
  if (
    ids.length > 6 ||
    ids.some((id) => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
  )
    throw new Error("参考素材标识无效或超过6张限制。");
  const rows = (
    await db.query<{ id: string }>(
      `select distinct ao.id from asset_objects ao
     left join generated_assets ga on ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path
     where ao.id=any($1::uuid[]) and ao.workspace_id=$2 and ao.created_by=$3 and ao.mime_type like 'image/%'
       and (ga.id is null or (ga.deleted_at is null and ga.retention_state='active' and ga.retention_until>now()))`,
      [ids, scope.workspaceId, scope.userId],
    )
  ).rows;
  const available = new Set(rows.map((row) => row.id));
  if (ids.some((id) => !available.has(id)))
    throw new Error(
      "参考素材已删除、到期或权限已撤销，本次生成未执行，请重新选择素材。",
    );
}
