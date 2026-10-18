alter table public.background_jobs
  add column if not exists provider_result jsonb;

alter table public.background_jobs
  add column if not exists sync_claimed_at timestamptz;
