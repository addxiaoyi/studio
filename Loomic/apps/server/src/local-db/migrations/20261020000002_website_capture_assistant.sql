create table if not exists website_capture_pairings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by uuid not null references app_users(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists website_capture_pairings_owner_idx
  on website_capture_pairings(created_by, created_at desc);

create table if not exists website_capture_connections (
  id uuid primary key default gen_random_uuid(),
  pairing_id uuid not null references website_capture_pairings(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  session_token_hash text not null unique,
  browser text not null default 'unknown' check (browser in ('chrome','edge','unknown')),
  platform text not null default 'unknown' check (platform in ('windows','macos','linux','unknown')),
  paused boolean not null default false,
  connected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disconnected_at timestamptz,
  revoked_at timestamptz
);

create index if not exists website_capture_connections_owner_idx
  on website_capture_connections(user_id, revoked_at, last_seen_at desc);

alter table website_capture_tasks
  add column if not exists assistant_connection_id uuid references website_capture_connections(id) on delete set null;

alter table website_capture_tasks
  add column if not exists follow_external boolean not null default false;

create index if not exists website_capture_tasks_assistant_idx
  on website_capture_tasks(assistant_connection_id, status);
