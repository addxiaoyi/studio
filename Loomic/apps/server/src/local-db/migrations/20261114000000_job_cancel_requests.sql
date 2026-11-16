alter table background_jobs
  add column if not exists cancel_requested_at timestamptz;

create index if not exists background_jobs_cancel_requested_idx
  on background_jobs(cancel_requested_at)
  where cancel_requested_at is not null and status = 'running';
