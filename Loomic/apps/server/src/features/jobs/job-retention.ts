import type { Pool } from "pg";

/**
 * How long a finished job keeps its request payload before it is cleared.
 * Payloads hold inline reference images (multi-megabyte data URIs), and nothing
 * reads them once the job has reached a terminal state.
 */
export const JOB_PAYLOAD_RETENTION_DAYS = 30;
export const JOB_PAYLOAD_RETENTION_BATCH_SIZE = 200;

export type JobPayloadRetentionOptions = {
  db: Pool;
  retentionDays?: number;
  batchSize?: number;
  log?: { info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void };
};

export type JobPayloadRetentionResult = { purged: number };

/**
 * Clear `payload` on terminal job rows past the retention window.
 *
 * The row itself is kept: status, timing, result, and cost stay available for history
 * and audit — only the request body is dropped. Failed and dead-letter rows are
 * deliberately excluded because `retryJob` re-enqueues them and the worker needs the
 * original payload to run them again.
 */
export async function purgeExpiredJobPayloads({
  db,
  retentionDays = JOB_PAYLOAD_RETENTION_DAYS,
  batchSize = JOB_PAYLOAD_RETENTION_BATCH_SIZE,
  log = console,
}: JobPayloadRetentionOptions): Promise<JobPayloadRetentionResult> {
  const days = Math.max(1, Math.floor(retentionDays));
  const limit = Math.max(1, Math.min(Math.floor(batchSize), JOB_PAYLOAD_RETENTION_BATCH_SIZE));

  const { rows } = await db.query<{ id: string }>(
    `update background_jobs
        set payload = '{}'::jsonb,
            payload_purged_at = now()
      where id in (
        select id
          from background_jobs
         where status in ('succeeded', 'canceled')
           and payload_purged_at is null
           and coalesce(completed_at, canceled_at, updated_at) < now() - make_interval(days => $1)
         order by coalesce(completed_at, canceled_at, updated_at) asc
         limit $2
      )
      returning id`,
    [days, limit],
  );

  const purged = rows.length;
  if (purged > 0) log.info?.(`[job-retention] cleared payload on ${purged} job(s)`);
  return { purged };
}
