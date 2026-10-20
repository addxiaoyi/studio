alter table website_capture_tasks
  add column if not exists background_job_id uuid references background_jobs(id) on delete set null;

create index if not exists website_capture_tasks_background_job_idx
  on website_capture_tasks(background_job_id);
