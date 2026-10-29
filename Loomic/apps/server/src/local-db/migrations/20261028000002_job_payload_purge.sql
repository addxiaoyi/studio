-- Track whether a finished job's request payload has been cleared.
-- Terminal job rows keep multi-megabyte inline reference images in `payload`
-- (see 20261028000001_job_payload_summary). The retention sweep clears those
-- payloads; the marker keeps the sweep from re-reading the same blobs every run.
alter table background_jobs add column if not exists payload_purged_at timestamptz;

create index if not exists background_jobs_retention_idx
  on background_jobs(status, completed_at)
  where payload_purged_at is null;
