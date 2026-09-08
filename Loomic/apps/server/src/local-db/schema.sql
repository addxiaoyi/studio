create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists login_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists login_tokens_active_idx
  on login_tokens(token_hash, expires_at) where used_at is null;

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists sessions_active_idx
  on sessions(token_hash, expires_at);

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references app_users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by uuid references app_users(id) on delete set null,
  name text not null,
  slug text not null,
  description text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table if not exists canvases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  created_by uuid references app_users(id) on delete set null,
  name text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table canvases add column if not exists content jsonb not null default '{}'::jsonb;

create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  canvas_id uuid not null references canvases(id) on delete cascade,
  created_by uuid references app_users(id) on delete set null,
  thread_id text not null,
  title text not null default 'New Chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  tool_activities jsonb,
  content_blocks jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_sessions_canvas_idx on chat_sessions(canvas_id);
create index if not exists chat_messages_session_idx on chat_messages(session_id, created_at);

create table if not exists asset_objects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  bucket text not null,
  object_path text not null unique,
  mime_type text,
  byte_size bigint,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists credit_balances (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references app_users(id) on delete set null,
  transaction_type text not null,
  amount integer not null,
  balance_after integer,
  job_id text,
  description text,
  created_at timestamptz not null default now()
);
create index if not exists credit_transactions_workspace_idx on credit_transactions(workspace_id, created_at desc);

create table if not exists workspace_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  default_model text not null,
  updated_at timestamptz not null default now()
);

create table if not exists brand_kits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  name text not null default '未命名',
  is_default boolean not null default false,
  guidance_text text,
  cover_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists brand_kits_default_idx on brand_kits(user_id) where is_default;

create table if not exists brand_kit_assets (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references brand_kits(id) on delete cascade,
  asset_type text not null check (asset_type in ('color', 'font', 'logo', 'image')),
  display_name text not null default '',
  role text,
  sort_order integer not null default 0,
  text_content text,
  file_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists brand_kit_assets_kit_idx on brand_kit_assets(kit_id, sort_order, created_at);

create unique index if not exists canvases_one_primary_per_project_idx
  on canvases(project_id) where is_primary;
