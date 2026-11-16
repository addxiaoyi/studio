alter table background_jobs add column if not exists billing_approval_id uuid references generation_approvals(id);

create index if not exists credit_transactions_generation_job_idx
  on credit_transactions(job_id,transaction_type)
  where transaction_type in ('generation_deduct','generation_refund','generation_adjustment');
create index if not exists background_jobs_canceled_refund_idx
  on background_jobs(updated_at,id)
  where status='canceled' and job_type in ('image_generation','video_generation')
    and attempt_count=0 and started_at is null and provider_result is null and billing_receipt is null;

create or replace function preserve_reservation_approval() returns trigger language plpgsql as $$
begin
  if old.billing_approval_id is not null and old.billing_approval_id is distinct from new.billing_approval_id
    and (old.credits_transaction_id is not null or old.billing_receipt is not null) then
    raise exception 'reservation_approval_is_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists reservation_approval_immutable on background_jobs;
create trigger reservation_approval_immutable before update of billing_approval_id on background_jobs
  for each row execute function preserve_reservation_approval();
