import type { Pool } from "pg";

export async function findCanvasAssetSource(
  db: Pool,
  id: string,
  workspaceId: string,
  userId: string,
) {
  const { rows } = await db.query<{
    asset_id: string;
    library_asset_id: string;
    mime_type: string;
    title: string | null;
    retention_until: string | null;
  }>(
    `select ao.id as asset_id, coalesce(ga.id,ao.id) as library_asset_id,
      ao.mime_type, ga.title, ga.retention_until
    from asset_objects ao
    left join generated_assets ga on ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path
    where (ao.id=$1 or ga.id=$1) and ao.workspace_id=$2
      and exists(select 1 from workspace_members wm where wm.workspace_id=ao.workspace_id and wm.user_id=$3)
      and (ao.bucket not in ('private-video','private-try-on') or ao.created_by=$3)
      and ga.deleted_at is null and coalesce(ga.retention_state,'active')='active'
      and coalesce(ga.retention_until,ao.created_at+interval '3 days')>now()
      and (ao.mime_type like 'image/%' or ao.mime_type like 'video/%' or ao.mime_type like 'audio/%')
    order by (ao.id=$1) desc limit 1`,
    [id, workspaceId, userId],
  );
  const asset = rows[0];
  if (!asset) return null;
  return {
    assetId: asset.asset_id,
    libraryAssetId: asset.library_asset_id,
    mimeType: asset.mime_type,
    title: asset.title,
    retentionUntil: asset.retention_until,
  };
}
