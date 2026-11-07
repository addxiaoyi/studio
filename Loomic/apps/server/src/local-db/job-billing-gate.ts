// Approval jobs are queued before the separate credit reservation finishes.
export const approvalBillingReady = `(job_type not in ('image_generation','video_generation')
  or left(coalesce(idempotency_key,''), 9) <> 'approval:'
  or (credits_transaction_id is not null and credits_cost > 0)
  or exists (select 1 from generation_approvals approval
    where approval.job_id = background_jobs.id and approval.status = 'approved'
      and approval.consumed_at is not null and approval.estimated_credits = 0))`;
