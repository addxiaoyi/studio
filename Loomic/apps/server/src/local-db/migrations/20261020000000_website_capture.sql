create table if not exists website_capture_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by uuid not null references app_users(id) on delete cascade,
  session_id uuid references chat_sessions(id) on delete set null,
  mode text not null check (mode in ('isolated', 'local')),
  start_url text not null,
  page_limit integer not null default 3 check (page_limit between 1 and 5),
  record_video boolean not null default true,
  idempotency_key text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  progress integer not null default 0 check (progress between 0 and 100),
  stage text not null default 'queued',
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (created_by, idempotency_key)
);

create index if not exists website_capture_tasks_owner_idx
  on website_capture_tasks(created_by, updated_at desc);

create table if not exists website_capture_events (
  id bigserial primary key,
  task_id uuid not null references website_capture_tasks(id) on delete cascade,
  stage text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists website_capture_events_task_idx
  on website_capture_events(task_id, id);
