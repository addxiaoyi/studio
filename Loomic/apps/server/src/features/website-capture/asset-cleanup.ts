import type { Pool } from "pg";

export const WEBSITE_CAPTURE_FAILURE_RECOVERY_DAYS = 7;

/**
 * Keep failed capture evidence recoverable briefly, then let the normal asset
 * retention worker purge it. This removes failed output from the active library
 * without deleting storage directly from an error path.
 */
export async function softDeleteWebsiteCaptureAssets(db: Pool, taskId: string): Promise<number> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const assets = await client.query<{ id: string }>(
      "select id from generated_assets where website_capture_task_id=$1 and deleted_at is null for update",
      [taskId],
    );
    const ids = assets.rows.map((row) => row.id);
    if (!ids.length) {
      await client.query("commit");
      return 0;
    }
    await client.query(
      `update generated_assets
          set deleted_at=now(), retention_state='soft_deleted',
              retention_until=coalesce(retention_until, now()),
              purge_after=now() + ($2 * interval '1 day'), updated_at=now()
        where id=any($1::uuid[]) and deleted_at is null`,
      [ids, WEBSITE_CAPTURE_FAILURE_RECOVERY_DAYS],
    );
    await client.query(
      `update gallery_items set status='removed', deleted_at=now(), updated_at=now()
        where asset_id=any($1::uuid[]) and status <> 'removed'`,
      [ids],
    );
    await client.query("commit");
    return ids.length;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
