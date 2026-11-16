// A linked charge must still be reserved when the Worker claims the task.
export const approvalBillingReady = `(job_type not in ('image_generation','video_generation')
  or (not billing_required and left(coalesce(idempotency_key,''), 9) <> 'approval:'
    and not exists(select 1 from credit_transactions refund where refund.job_id=background_jobs.id::text
      and refund.transaction_type='generation_refund'))
  or (credits_transaction_id is not null and credits_cost > 0 and exists (
    select 1 from credit_transactions charge where charge.id=background_jobs.credits_transaction_id
      and charge.workspace_id=background_jobs.workspace_id and charge.user_id=background_jobs.created_by
      and charge.job_id=background_jobs.id::text and charge.transaction_type='generation_deduct'
      and -charge.amount=coalesce((background_jobs.billing_receipt->>'reservedCredits')::numeric,background_jobs.credits_cost))
    and not exists(select 1 from credit_transactions refund where refund.job_id=background_jobs.id::text
      and refund.transaction_type='generation_refund'))
  or exists (select 1 from generation_approvals approval
    where approval.job_id = background_jobs.id and approval.status = 'approved'
      and approval.workspace_id=background_jobs.workspace_id and approval.user_id=background_jobs.created_by
      and approval.consumed_at is not null and approval.estimated_credits = 0
      and coalesce(background_jobs.credits_cost,0)=0 and background_jobs.credits_transaction_id is null
      and not exists(select 1 from credit_transactions debit where debit.job_id=background_jobs.id::text
        and debit.transaction_type='generation_deduct')))`;
