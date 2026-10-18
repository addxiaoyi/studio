create table if not exists trend_sources (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null, platform text not null, source_type text not null check (source_type in ('rss','api')),
  url text not null, config jsonb not null default '{}'::jsonb, enabled boolean not null default true,
  refresh_minutes integer not null default 60 check (refresh_minutes between 5 and 10080),
  last_synced_at timestamptz, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists trend_items (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
  source_id uuid references trend_sources(id) on delete set null, external_id text, platform text not null,
  title text not null, summary text not null default '', source_url text, heat numeric(14,4), tags text[] not null default '{}',
  dedupe_key text not null, published_at timestamptz, fetched_at timestamptz not null default now(), ignored_at timestamptz, favorited_at timestamptz,
  unique(workspace_id,dedupe_key)
);
create index if not exists trend_items_feed_idx on trend_items(workspace_id, fetched_at desc);
create table if not exists content_packages (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by uuid not null references public.profiles(id), trend_item_id uuid references trend_items(id) on delete set null,
  title text not null, topic text not null default '', brief text not null, goal text not null, content_type text not null,
  platforms text[] not null, duration_seconds integer not null, workflow_mode text not null check (workflow_mode in ('review','automatic')),
  status text not null default 'draft', model_id text, estimated_cost_cny numeric(14,4), actual_cost_cny numeric(14,4), max_cost_cny numeric(14,4),
  structure jsonb, version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists content_packages_workspace_idx on content_packages(workspace_id, updated_at desc);
create table if not exists content_variants (
  id uuid primary key default gen_random_uuid(), package_id uuid not null references content_packages(id) on delete cascade,
  platform text not null, version integer not null default 1, title text not null, body text not null default '', hashtags text[] not null default '{}',
  cover_text text not null default '', locked boolean not null default false, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(package_id,platform,version)
);
create table if not exists content_artifacts (
  id uuid primary key default gen_random_uuid(), package_id uuid not null references content_packages(id) on delete cascade,
  variant_id uuid references content_variants(id) on delete set null, asset_id uuid references generated_assets(id) on delete set null,
  artifact_type text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists publishing_accounts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
  platform text not null, alias text not null, notes text not null default '', created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,platform,alias)
);
create table if not exists publishing_plans (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
  package_id uuid not null references content_packages(id) on delete cascade, variant_id uuid references content_variants(id) on delete set null,
  platform text not null, account_alias text not null, scheduled_at timestamptz not null,
  status text not null default 'scheduled', external_url text, published_at timestamptz, created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists publishing_plans_due_idx on publishing_plans(workspace_id,status,scheduled_at);
create table if not exists post_metrics (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
  package_id uuid not null references content_packages(id) on delete cascade, variant_id uuid references content_variants(id) on delete set null,
  platform text not null, account_alias text not null, post_url text not null, published_at timestamptz not null,
  impressions bigint not null default 0, views bigint not null default 0, completions bigint not null default 0,
  likes bigint not null default 0, comments bigint not null default 0, shares bigint not null default 0, saves bigint not null default 0,
  clicks bigint not null default 0, leads bigint not null default 0, conversions bigint not null default 0,
  spend_cny numeric(14,4) not null default 0, revenue_cny numeric(14,4) not null default 0, raw jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(), unique(workspace_id,platform,account_alias,post_url)
);
create table if not exists content_insights (
  id uuid primary key default gen_random_uuid(), package_id uuid not null references content_packages(id) on delete cascade,
  summary text not null, metrics jsonb not null default '{}'::jsonb, recommendations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
