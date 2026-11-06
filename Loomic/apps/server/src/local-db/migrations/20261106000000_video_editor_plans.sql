create table if not exists video_editor_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  composition_id text not null,
  revision text not null,
  plan jsonb not null,
  fingerprint text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'completed')),
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  completed_at timestamptz
);
create index if not exists video_editor_plans_owner_idx on video_editor_plans(user_id, created_at desc);
