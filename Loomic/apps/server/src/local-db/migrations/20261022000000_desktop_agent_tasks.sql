create table if not exists desktop_agent_tasks (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by uuid not null references app_users(id) on delete cascade,
  connection_id uuid not null references website_capture_connections(id) on delete cascade,
  goal text not null,
  role text not null check (role in ('planner','researcher','operator','reviewer')),
  capabilities jsonb not null default '[]'::jsonb,
  target_url text,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','canceled')),
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists desktop_agent_events (
  id bigserial primary key,
  task_id uuid not null references desktop_agent_tasks(id) on delete cascade,
  event_type text not null,
  detail text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists desktop_agent_tasks_owner_idx
  on desktop_agent_tasks(created_by, created_at desc);
create index if not exists desktop_agent_events_task_idx
  on desktop_agent_events(task_id, created_at);
