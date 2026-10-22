alter table generated_assets
  add column if not exists website_capture_task_id uuid references website_capture_tasks(id) on delete set null;

create index if not exists generated_assets_website_capture_task_idx
  on generated_assets(website_capture_task_id)
  where website_capture_task_id is not null;
