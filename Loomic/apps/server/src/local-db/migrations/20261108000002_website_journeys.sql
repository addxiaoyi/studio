alter table website_capture_tasks add column if not exists journey jsonb;
alter table agent_browser_views add column if not exists handoff boolean not null default false;
create table if not exists website_handoff_commands (
  id uuid primary key,
  view_id uuid not null references agent_browser_views(id) on delete cascade,
  task_id uuid not null references website_capture_tasks(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  ciphertext text,
  page_url text not null,
  status text not null default 'pending' check(status in ('pending','claimed','succeeded','failed','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default(now()+interval '20 seconds')
);
create index if not exists website_handoff_pending on website_handoff_commands(view_id,created_at) where status='pending';
create table if not exists website_browser_sessions (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  origin text not null,
  ciphertext text,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique(workspace_id,user_id,origin)
);
