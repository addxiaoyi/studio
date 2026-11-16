import type { Pool } from "pg";
import { JOB_SHUTDOWN_STAGE } from "./job-shutdown-checkpoint.js";

const STALE_VIDEO_LIMIT = "30 minutes";
const RECOVERY_GRACE = "10 minutes";
export const JOB_RECOVERED_STAGE = "worker_recovered_waiting";

export async function recoverInterruptedJobs(database: Pick<Pool, "query">) {
  const expired = await database.query(
    `update background_jobs
     set status = 'failed',
         error_code = 'stale_job_timeout',
         error_message = 'Job exceeded the 30-minute recovery window.',
         failed_at = now(),
         updated_at = now()
     where status = 'running'
       and job_type = 'video_generation'
       and updated_at < now() - interval '${STALE_VIDEO_LIMIT}'
     returning id`,
  );
  const recovered = await database.query(
    `update background_jobs
     set status = 'queued', stage = $2, updated_at = now()
     where status = 'running'
       and attempt_count < max_attempts
       and (
         stage = $1
         or (
           updated_at < now() - interval '${RECOVERY_GRACE}'
           and (job_type <> 'video_generation' or updated_at >= now() - interval '${STALE_VIDEO_LIMIT}')
         )
       )
     returning id`,
    [JOB_SHUTDOWN_STAGE, JOB_RECOVERED_STAGE],
  );

  return {
    expired: expired.rowCount ?? expired.rows.length,
    recovered: recovered.rowCount ?? recovered.rows.length,
  };
}
