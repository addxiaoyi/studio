import type { Pool } from "pg";
import type { WorkflowGraph } from "@helstera/shared";

type Source = {
  canvasId: string | null;
  workspaceId: string;
  userId: string;
  elementId: string;
  assetId: string;
  mediaType: "image" | "video";
};
export async function readWorkflowMaterial(
  db: Pick<Pool, "query">,
  source: Source,
) {
  if (!source.canvasId) throw new Error("素材输入需要关联画布。");
  const row = (
    await db.query<{ id: string; bucket: string; object_path: string }>(
      `
    select ao.id,ao.bucket,ao.object_path from canvases c
    join projects p on p.id=c.project_id and p.archived_at is null
    join workspace_members m on m.workspace_id=p.workspace_id and m.user_id=$3
    join asset_objects ao on ao.workspace_id=p.workspace_id and ao.created_by=$3
    left join generated_assets ga on ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path
    where c.id=$1 and p.workspace_id=$2 and (ao.id=$4 or ga.id=$4)
      and ao.mime_type like $6 and (ga.id is null or (ga.deleted_at is null and ga.retention_state='active' and ga.retention_until>now()))
      and exists(select 1 from jsonb_array_elements(coalesce(c.content->'elements','[]')) el
        where el->>'id'=$5 and coalesce((el->>'isDeleted')::boolean,false)=false
        and (el->'customData'->>'assetId'=ao.id::text or el->'customData'->>'assetId'=ga.id::text))
    limit 1`,
      [
        source.canvasId,
        source.workspaceId,
        source.userId,
        source.assetId,
        source.elementId,
        `${source.mediaType}/%`,
      ],
    )
  ).rows[0];
  if (!row)
    throw new Error("画布素材已删除、到期或无访问权限。请重新选择并保存画布。");
  return row;
}
export async function assertWorkflowMaterials(
  db: Pick<Pool, "query">,
  graph: WorkflowGraph,
  scope: Pick<Source, "canvasId" | "workspaceId" | "userId">,
) {
  for (const node of graph.nodes) {
    if (node.config.kind === "asset")
      await readWorkflowMaterial(db, { ...scope, ...node.config });
  }
}
