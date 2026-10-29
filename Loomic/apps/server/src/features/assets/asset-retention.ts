import type { Pool } from "pg";

import type { StorageProvider } from "../../storage/storage-provider.js";

export const ASSET_RETENTION_DAYS = 3;
export const ASSET_RETENTION_BATCH_SIZE = 100;

type ExpiredAsset = {
  object_id: string;
  generated_asset_id: string;
  workspace_id: string;
  bucket: string;
  object_path: string;
  retention_state: "active" | "soft_deleted";
  created_by: string | null;
};

type AssetRetentionOptions = {
  db: Pool;
  storage: StorageProvider;
  batchSize?: number;
  log?: Pick<Console, "error" | "info">;
};

export type AssetRetentionResult = {
  purged: number;
  failed: number;
};

export async function cleanExpiredGeneratedAssets({
  db,
  storage,
  batchSize = ASSET_RETENTION_BATCH_SIZE,
  log = console,
}: AssetRetentionOptions): Promise<AssetRetentionResult> {
  const { rows } = await db.query<ExpiredAsset>(
    `select ao.id as object_id, ga.id as generated_asset_id, ao.workspace_id, ao.bucket, ao.object_path, ga.retention_state, ga.created_by
     from asset_objects ao
     join generated_assets ga
       on ga.workspace_id = ao.workspace_id
      and ga.object_path = ao.object_path
      and ((ga.retention_state = 'active' and ga.retention_until <= now())
        or (ga.retention_state = 'soft_deleted' and ga.purge_after <= now()))
     where (ao.mime_type like 'image/%' or ao.mime_type like 'video/%')
       -- Keep implementation screenshots out of this lifecycle task.
       and ao.object_path not like '%/gen-canvas-screenshot-%'
     order by ao.created_at asc
     limit $1`,
    [Math.max(1, Math.min(batchSize, ASSET_RETENTION_BATCH_SIZE))],
  );

  let purged = 0;
  let failed = 0;

  for (const asset of rows) {
    const { error } = await storage.remove(asset.bucket, [asset.object_path]);
    if (error) {
      failed += 1;
      log.error(`[asset-retention] could not remove ${asset.object_path}:`, error);
      continue;
    }

    const client = await db.connect();
    try {
      await client.query("begin");
      if (asset.created_by) {
        await client.query(
          `insert into notifications(workspace_id,user_id,type,title,body,metadata)
           values($1,$2,'asset_purged',$3,$4,$5::jsonb)`,
          [asset.workspace_id, asset.created_by, "Cloud asset removed", "This cloud asset reached its retention deadline and was removed. A copy saved to your computer is unaffected.", JSON.stringify({ assetId: asset.generated_asset_id })],
        );
      }
      await client.query(
        `update gallery_items
         set status = 'removed', deleted_at = now(), updated_at = now()
         where workspace_id = $1
           and asset_id in (
             select id from generated_assets
             where workspace_id = $1 and object_path = $2
           )`,
        [asset.workspace_id, asset.object_path],
      );
      await client.query(
        `update generated_assets
         set deleted_at = now(), retention_state = 'purged', purge_after = now(), updated_at = now()
         where workspace_id = $1 and object_path = $2`,
        [asset.workspace_id, asset.object_path],
      );
      await client.query("delete from asset_objects where id = $1", [asset.object_id]);
      await client.query("commit");
      purged += 1;
    } catch (error) {
      await client.query("rollback");
      failed += 1;
      log.error(`[asset-retention] could not remove metadata for ${asset.object_path}:`, error);
    } finally {
      client.release();
    }
  }

  if (purged || failed) {
    log.info(`[asset-retention] purged=${purged} failed=${failed}`);
  }
  return { purged, failed };
}
