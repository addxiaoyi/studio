alter table background_jobs add column if not exists billing_receipt jsonb;

create unique index if not exists credit_generation_adjustment_once_idx
  on credit_transactions(workspace_id,job_id)
  where transaction_type='generation_adjustment' and job_id is not null;
