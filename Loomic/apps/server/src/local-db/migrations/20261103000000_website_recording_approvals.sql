create table if not exists website_recording_approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references website_capture_tasks(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  action jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'consumed', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  approved_at timestamptz,
  consumed_at timestamptz,
  rejected_at timestamptz
);

create index if not exists website_recording_approvals_task_idx
  on website_recording_approvals(task_id, created_at desc);

create unique index if not exists website_recording_approvals_active_idx
  on website_recording_approvals(task_id) where status in ('pending', 'approved');
