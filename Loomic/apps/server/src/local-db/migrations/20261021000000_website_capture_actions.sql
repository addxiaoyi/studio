create table if not exists website_capture_actions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references website_capture_tasks(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  connection_id uuid not null references website_capture_connections(id) on delete cascade,
  action jsonb not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired','executed')),
  approval_token_hash text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  approved_at timestamptz,
  rejected_at timestamptz,
  consumed_at timestamptz
);

create index if not exists website_capture_actions_task_idx
  on website_capture_actions(task_id, status, created_at desc);
