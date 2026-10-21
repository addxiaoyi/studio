alter table website_capture_tasks
  add column if not exists promo jsonb,
  add column if not exists promo_status text not null default 'not_requested' check (promo_status in ('not_requested','awaiting_approval','queued','running','succeeded','failed','rejected')),
  add column if not exists promo_approval_id uuid references generation_approvals(id) on delete set null,
  add column if not exists promo_job_id uuid references background_jobs(id) on delete set null,
  add column if not exists promo_asset_id uuid references asset_objects(id) on delete set null,
  add column if not exists promo_video_url text,
  add column if not exists promo_error text;

create index if not exists website_capture_tasks_promo_job_idx on website_capture_tasks(promo_job_id);
