-- Track whether a finished job's request payload has been cleared (see the local
-- migration of the same version).
alter table public.background_jobs add column if not exists payload_purged_at timestamptz;

create index if not exists background_jobs_retention_idx
  on public.background_jobs(status, completed_at)
  where payload_purged_at is null;
