create table if not exists creative_library (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by uuid not null references app_users(id) on delete cascade,
  name text not null,
  description text not null default '',
  body jsonb not null,
  revision integer not null default 1,
  request_key uuid not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,created_by,request_key)
);
create index if not exists creative_library_owner_idx on creative_library(workspace_id,created_by,updated_at desc) where archived_at is null;
