import type { Pool } from "pg";
import { cancelUnstartedJob } from "../features/jobs/cancel-unstarted-job.js";
import { JobServiceError } from "../features/jobs/job-service.js";

const REFUND_BATCH_SIZE = 100;

export async function recoverCanceledRefunds(db: Pool) {
  const candidates = await db.query<{ id: string; created_by: string }>(
    `select j.id,j.created_by from background_jobs j
     where j.status='canceled' and j.job_type in ('image_generation','video_generation')
       and j.attempt_count=0 and j.started_at is null and j.provider_result is null and j.billing_receipt is null
       and j.error_code is distinct from 'cancel_refund_review_required'
       and exists(select 1 from credit_transactions t where t.job_id=j.id::text and t.transaction_type='generation_deduct')
       and not exists(select 1 from credit_transactions t where t.job_id=j.id::text and t.transaction_type='generation_refund')
     order by j.updated_at,j.id limit $1`, [REFUND_BATCH_SIZE],
  );
  const refunded: string[] = [];
  const review: string[] = [];
  const failed: string[] = [];
  for (const job of candidates.rows) {
    try {
      await cancelUnstartedJob(db, job.id, job.created_by);
      refunded.push(job.id);
    } catch (cause) {
      const requiresReview = cause instanceof JobServiceError && cause.statusCode === 409;
      // Keep broken legacy rows from starving later batches; never fabricate a refund.
      await db.query(`update background_jobs set updated_at=now(),
        error_code=case when $2 then 'cancel_refund_review_required' else error_code end,
        error_message=case when $2 then '取消退款账本需核验，请在任务记录中查看。' else error_message end
        where id=$1 and status='canceled'`, [job.id, requiresReview]);
      (requiresReview ? review : failed).push(job.id);
      if (!requiresReview) console.error(`[cancel-refund:${job.id}] recovery failed`, cause);
    }
  }
  return { refunded, review, failed };
}
