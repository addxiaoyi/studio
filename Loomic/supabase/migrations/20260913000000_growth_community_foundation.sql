create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade, type text not null, title text not null,
  body text not null default '', metadata jsonb not null default '{}'::jsonb, read_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists notifications_user_feed_idx on public.notifications(user_id, read_at, created_at desc);

create table if not exists public.daily_checkins (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade, checkin_date date not null,
  streak integer not null default 1, credits_granted integer not null default 0, created_at timestamptz not null default now(), unique(user_id, checkin_date)
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade, code text not null unique,
  invitee_id uuid references public.profiles(id) on delete set null, accepted_at timestamptz,
  inviter_reward integer not null default 0, invitee_reward integer not null default 0, created_at timestamptz not null default now(),
  check (invitee_id is null or invitee_id <> inviter_id)
);

create table if not exists public.generated_assets (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null, created_by uuid references public.profiles(id) on delete set null,
  source_job_id uuid references public.background_jobs(id) on delete set null, parent_asset_id uuid references public.generated_assets(id) on delete set null,
  media_type text not null check (media_type in ('image','video')), object_path text not null, mime_type text,
  title text not null default '', description text not null default '', prompt text not null default '', metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz, created_at timestamptz not null default now(), unique(workspace_id, object_path)
);
create index if not exists generated_assets_owner_idx on public.generated_assets(workspace_id, created_by, created_at desc) where deleted_at is null;

create table if not exists public.gallery_items (
  id uuid primary key default gen_random_uuid(), asset_id uuid not null unique references public.generated_assets(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade, owner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','published','hidden','removed')), featured boolean not null default false,
  like_count integer not null default 0, comment_count integer not null default 0, published_at timestamptz, deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists gallery_public_feed_idx on public.gallery_items(featured desc, published_at desc) where status = 'published' and deleted_at is null;

create table if not exists public.gallery_likes (
  gallery_id uuid not null references public.gallery_items(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(gallery_id, user_id)
);
create table if not exists public.gallery_comments (
  id uuid primary key default gen_random_uuid(), gallery_id uuid not null references public.gallery_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade, body text not null, request_id uuid not null,
  status text not null default 'visible' check (status in ('visible','hidden','removed')), created_at timestamptz not null default now(), unique(user_id, request_id)
);
create index if not exists gallery_comments_feed_idx on public.gallery_comments(gallery_id, created_at);
create table if not exists public.asset_favorites (
  asset_id uuid not null references public.generated_assets(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(asset_id, user_id)
);

create table if not exists public.prompt_entries (
  id uuid primary key default gen_random_uuid(), workspace_id uuid references public.workspaces(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null, title text not null, prompt text not null, category text not null default '',
  tags text[] not null default '{}', published boolean not null default false, favorite_count integer not null default 0,
  view_count integer not null default 0, deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists prompt_entries_feed_idx on public.prompt_entries(published, category, created_at desc) where deleted_at is null;
create table if not exists public.prompt_favorites (
  prompt_id uuid not null references public.prompt_entries(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(prompt_id, user_id)
);

create table if not exists public.membership_entitlements (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade, plan text not null default 'free',
  status text not null default 'inactive' check (status in ('inactive','active','past_due','cancelled','expired')),
  starts_at timestamptz, expires_at timestamptz, metadata jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null, action text not null, target_type text not null, target_id text,
  before_state jsonb, after_state jsonb, request_id text, created_at timestamptz not null default now()
);
create index if not exists admin_audit_feed_idx on public.admin_audit_logs(workspace_id, created_at desc);
