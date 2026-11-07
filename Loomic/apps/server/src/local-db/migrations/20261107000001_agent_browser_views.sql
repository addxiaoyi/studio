create table if not exists agent_browser_views (
  id uuid primary key,
  task_id uuid not null,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  engine text not null check (engine in ('chromix','chromium')),
  name text not null,
  url text not null default '',
  title text not null default '',
  state text not null default 'starting' check (state in ('starting','running','paused','completed','failed')),
  control text not null default 'agent' check (control in ('agent','paused')),
  width integer not null default 1280,
  height integer not null default 720,
  frame_revision bigint not null default 0,
  cursor jsonb,
  detail text not null default '',
  heartbeat_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour'
);
create index if not exists agent_browser_views_owner_idx
  on agent_browser_views(workspace_id,user_id,updated_at desc);
create index if not exists agent_browser_views_expiry_idx on agent_browser_views(expires_at);
