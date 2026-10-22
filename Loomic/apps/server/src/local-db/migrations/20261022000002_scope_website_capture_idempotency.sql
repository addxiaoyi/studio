alter table website_capture_tasks
  drop constraint if exists website_capture_tasks_created_by_idempotency_key_key;

create unique index if not exists website_capture_tasks_workspace_idempotency_idx
  on website_capture_tasks(workspace_id, created_by, idempotency_key);
