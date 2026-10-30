create extension if not exists pgcrypto;

create table if not exists schema_migrations (
  version text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  avatar_url text,
  password_hash text,
  system_role text not null default 'member' check (system_role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app_users
  add column if not exists system_role text not null default 'member'
  check (system_role in ('admin', 'member'));

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

create table if not exists email_verification_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_verification_codes_active_idx
  on email_verification_codes(user_id, expires_at) where used_at is null;

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

create unique index if not exists workspaces_owner_user_id_unique
  on workspaces(owner_user_id);

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
  source text not null default 'manual' check (source in ('home', 'manual', 'import')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

alter table projects add column if not exists source text not null default 'manual';

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
  client_message_id text,
  created_at timestamptz not null default now()
);

create index if not exists chat_sessions_canvas_idx on chat_sessions(canvas_id);
create index if not exists chat_messages_session_idx on chat_messages(session_id, created_at);
alter table chat_messages add column if not exists client_message_id text;
create unique index if not exists chat_messages_session_client_message_idx on chat_messages(session_id, client_message_id);

create table if not exists project_story_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in ('character', 'scene', 'prop')),
  name text not null,
  description text not null default '',
  image_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_story_assets_project_idx
  on project_story_assets(project_id, kind, updated_at desc);

-- Storyboards and generation jobs reference generated assets, so this table
-- must exist before the storyboard tables are created.
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

create table if not exists project_storyboards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  scene_no integer not null check (scene_no > 0),
  title text not null,
  script text not null default '',
  shot_prompt text not null default '',
  image_asset_id uuid references asset_objects(id) on delete set null,
  video_asset_id uuid references asset_objects(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'queued', 'generating', 'ready', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, scene_no)
);

create index if not exists project_storyboards_project_idx
  on project_storyboards(project_id, scene_no);

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
  chat_model text,
  default_model_url text,
  default_model_key_ciphertext text,
  chat_model_url text,
  chat_model_key_ciphertext text,
  updated_at timestamptz not null default now()
);

alter table workspace_settings add column if not exists chat_model text;
alter table workspace_settings add column if not exists default_model_url text;
alter table workspace_settings add column if not exists default_model_key_ciphertext text;
alter table workspace_settings add column if not exists chat_model_url text;
alter table workspace_settings add column if not exists chat_model_key_ciphertext text;

-- Provider/product model policy lives in migration 20261029000001_provider_model_policy_once.sql.
-- It must NOT live here: schema.sql is replayed on every deploy, so policy updates placed here
-- reset the model circuit breaker and pricing on each release.

alter table workspace_settings add column if not exists auto_approve_paid_generation boolean not null default false;
alter table workspace_settings add column if not exists auto_delete_empty_canvas boolean not null default false;

create table if not exists generation_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  job_type text not null check (job_type in ('image_generation','video_generation')),
  model text not null,
  payload jsonb not null,
  payload_fingerprint text not null,
  estimated_credits numeric(14,4) not null check (estimated_credits > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  consumed_at timestamptz,
  rejected_at timestamptz,
  context jsonb not null default '{}'::jsonb
);
alter table generation_approvals add column if not exists consumed_at timestamptz;
alter table generation_approvals add column if not exists rejected_at timestamptz;
alter table generation_approvals add column if not exists context jsonb not null default '{}'::jsonb;
alter table generation_approvals add column if not exists job_id uuid;
create index if not exists generation_approvals_active_idx on generation_approvals(workspace_id,status,expires_at);
create unique index if not exists generation_approvals_consumed_once_idx
  on generation_approvals(id) where consumed_at is not null;
create table if not exists provider_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  label text not null,
  base_url text not null,
  key_ciphertext text not null,
  key_last4 text not null,
  enabled boolean not null default true,
  health_status text not null default 'unknown',
  models jsonb not null default '[]'::jsonb,
  failure_count integer not null default 0,
  latency_ms integer,
  last_error text,
  last_probed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists provider_configs_workspace_idx on provider_configs(workspace_id);
alter table provider_configs add column if not exists api_format text not null default 'openai';
alter table provider_configs add column if not exists request_template jsonb;
alter table provider_configs add column if not exists response_template jsonb;

create table if not exists provider_models (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references provider_configs(id) on delete cascade,
  model_id text not null,
  display_name text not null,
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  enabled boolean not null default true,
  billing_unit text not null default 'per_generation' check (billing_unit in ('per_generation', 'per_second', 'per_million_tokens')),
  price_credits numeric(12,4) not null default 5 check (price_credits >= 0),
  input_token_price_cny numeric(12,4) check (input_token_price_cny >= 0),
  output_token_price_cny numeric(12,4) check (output_token_price_cny >= 0),
  supports_input_image boolean not null default false,
  supports_input_video boolean not null default false,
  supports_audio boolean not null default false,
  max_duration_seconds integer check (max_duration_seconds > 0),
  max_resolution text,
  priority integer not null default 100,
  health_status text not null default 'unknown',
  failure_count integer not null default 0,
  last_error text,
  last_failed_at timestamptz,
  last_succeeded_at timestamptz,
  cooldown_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_id, model_id)
);
create index if not exists provider_models_route_idx on provider_models(model_id, enabled, priority);
alter table provider_models add column if not exists health_status text not null default 'unknown';
alter table provider_models add column if not exists failure_count integer not null default 0;
alter table provider_models add column if not exists last_error text;
alter table provider_models add column if not exists last_failed_at timestamptz;
alter table provider_models add column if not exists last_succeeded_at timestamptz;
alter table provider_models add column if not exists cooldown_until timestamptz;
create index if not exists provider_models_health_idx on provider_models(model_id, enabled, health_status, cooldown_until, priority);

create table if not exists official_model_prices (
  price_key text primary key,
  provider_key text not null,
  provider_label text not null,
  model_id text not null,
  model_name text not null,
  media_type text not null check (media_type in ('image', 'video')),
  variant text not null,
  official_min numeric(14,6) not null check (official_min >= 0),
  official_max numeric(14,6) not null check (official_max >= official_min),
  currency text not null default 'USD' check (currency = 'USD'),
  billing_unit text not null check (billing_unit in ('per_image', 'per_second', 'per_million_tokens')),
  unit_label text not null,
  helstera_credits numeric(14,4) not null check (helstera_credits >= 0),
  helstera_unit_label text not null,
  note text,
  source_id text not null,
  source_label text not null,
  source_url text not null,
  snapshot_date date not null,
  last_verified_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table official_model_prices drop constraint if exists official_model_prices_billing_unit_check;
alter table official_model_prices add constraint official_model_prices_billing_unit_check
  check (billing_unit in ('per_image', 'per_second', 'per_million_tokens'));
create index if not exists official_model_prices_catalog_idx
  on official_model_prices(media_type, provider_key, model_name);

create table if not exists official_model_price_sources (
  source_id text primary key,
  label text not null,
  source_url text not null,
  automatic boolean not null default true,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'snapshot')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  item_count integer not null default 0 check (item_count >= 0),
  last_error text
);

-- gpt-image-1.5 retirement policy lives in 20261029000001_provider_model_policy_once.sql
-- for the same reason as the block above.

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
alter table projects add column if not exists brand_kit_id uuid references brand_kits(id) on delete set null;
alter table projects add column if not exists thumbnail_path text;

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

create table if not exists agent_runs (
  id uuid primary key,
  session_id uuid not null references chat_sessions(id) on delete cascade,
  thread_id text not null,
  status text not null check (status in ('accepted', 'running', 'completed', 'failed')),
  model text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  error_message text
);
create index if not exists agent_runs_session_idx on agent_runs(session_id, created_at desc);
create index if not exists agent_runs_thread_idx on agent_runs(thread_id, created_at desc);

create table if not exists skills (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  author text not null default 'system',
  version text not null default '1.0',
  license text,
  category text not null default 'custom',
  icon_name text,
  source text not null default 'system',
  skill_content text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  is_featured boolean not null default false,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists skill_files (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references skills(id) on delete cascade,
  file_path text not null,
  content text not null default '',
  mime_type text not null default 'text/plain',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (skill_id, file_path)
);

create table if not exists workspace_skills (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  installed_at timestamptz not null default now(),
  installed_by uuid references app_users(id) on delete set null,
  unique (workspace_id, skill_id)
);

alter table workspace_skills add column if not exists locked_version text;
alter table workspace_skills add column if not exists locked_at timestamptz;

create table if not exists skill_versions (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references skills(id) on delete cascade,
  version text not null,
  snapshot jsonb not null default '{}'::jsonb,
  source_url text,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (skill_id, version)
);
create index if not exists skill_versions_skill_idx on skill_versions(skill_id, created_at desc);

create table if not exists credit_topups (
  out_trade_no text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  package_id text not null,
  amount_cny_fen integer not null,
  amount_usd_cents integer not null,
  credits_granted integer not null,
  status text not null default 'pending',
  provider text not null,
  trade_no text,
  qr_code_url text,
  expired_at bigint not null,
  paid_at bigint,
  created_at bigint not null
);

create table if not exists payment_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  provider_event_id text,
  workspace_id uuid references workspaces(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  processed boolean not null default false,
  error_message text,
  progress integer not null default 0,
  stage text,
  created_at timestamptz not null default now()
);
create index if not exists payment_events_workspace_idx on payment_events(workspace_id, created_at desc);

create table if not exists contact_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  company text,
  phone text,
  team_size text,
  message text not null,
  plan text,
  source text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);
create index if not exists contact_inquiries_status_idx on contact_inquiries(status, created_at desc);

create table if not exists background_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  canvas_id uuid references canvases(id) on delete set null,
  session_id uuid references chat_sessions(id) on delete set null,
  thread_id text,
  idempotency_key text,
  queue_name text not null,
  job_type text not null,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  payload_summary jsonb,
  payload_purged_at timestamptz,
  result jsonb,
  error_code text,
  error_message text,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  canceled_at timestamptz
);
create index if not exists background_jobs_status_idx on background_jobs(status, created_at desc);
alter table background_jobs add column if not exists idempotency_key text;
create unique index if not exists background_jobs_idempotency_idx on background_jobs(created_by, idempotency_key) where idempotency_key is not null;
alter table background_jobs add column if not exists credits_cost integer;
alter table background_jobs add column if not exists credits_transaction_id uuid;
alter table background_jobs add column if not exists progress integer not null default 0;
alter table background_jobs add column if not exists stage text;
alter table background_jobs add column if not exists sync_attempt_count integer not null default 0;
alter table background_jobs add column if not exists sync_claimed_at timestamptz;
alter table background_jobs add column if not exists next_sync_at timestamptz;
alter table background_jobs add column if not exists sync_error_code text;
alter table background_jobs add column if not exists sync_error_message text;
alter table background_jobs add column if not exists provider_result jsonb;
create index if not exists background_jobs_sync_idx
  on background_jobs(status, next_sync_at)
  where status in ('sync_pending', 'sync_failed');
alter table credit_balances alter column balance type numeric(14,4) using balance::numeric;
alter table credit_transactions alter column amount type numeric(14,4) using amount::numeric;
alter table credit_transactions alter column balance_after type numeric(14,4) using balance_after::numeric;
alter table background_jobs alter column credits_cost type numeric(14,4) using credits_cost::numeric;

create unique index if not exists canvases_one_primary_per_project_idx
  on canvases(project_id) where is_primary;
create table if not exists ecom_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  product_name text not null,
  product_description text,
  scene_ids jsonb not null default '[]'::jsonb,
  outputs jsonb not null default '[]'::jsonb,
  ratio text,
  status text not null default 'pending',
  credits_charged numeric(14,4) not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ecom_jobs_user_created_idx on ecom_jobs(user_id, created_at desc);

-- Model prices are denominated in CNY/credits and may be fractional.
alter table ecom_jobs
  alter column credits_charged type numeric(14,4)
  using credits_charged::numeric;

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade, type text not null, title text not null,
  body text not null default '', metadata jsonb not null default '{}'::jsonb, read_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists douyin_webhook_events (
  id uuid primary key default gen_random_uuid(),
  msg_id text not null unique,
  client_key text,
  event_name text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
create index if not exists douyin_webhook_events_received_idx on douyin_webhook_events(received_at desc);
create index if not exists notifications_user_feed_idx on notifications(user_id, read_at, created_at desc);

create table if not exists daily_checkins (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade, checkin_date date not null,
  streak integer not null default 1, credits_granted integer not null default 0, created_at timestamptz not null default now(), unique(user_id, checkin_date)
);

create table if not exists invites (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
  inviter_id uuid not null references app_users(id) on delete cascade, code text not null unique,
  invitee_id uuid references app_users(id) on delete set null, accepted_at timestamptz,
  inviter_reward integer not null default 0, invitee_reward integer not null default 0, created_at timestamptz not null default now(),
  check (invitee_id is null or invitee_id <> inviter_id)
);

create table if not exists admin_audit_logs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_id uuid references app_users(id) on delete set null, action text not null, target_type text not null, target_id text,
  before_state jsonb, after_state jsonb, request_id text, created_at timestamptz not null default now()
);
create index if not exists admin_audit_feed_idx on admin_audit_logs(workspace_id, created_at desc);

create table if not exists generated_assets (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null, created_by uuid references app_users(id) on delete set null,
  source_job_id uuid references background_jobs(id) on delete set null, parent_asset_id uuid references generated_assets(id) on delete set null,
  media_type text not null check (media_type in ('image','video')), object_path text not null, mime_type text,
  title text not null default '', description text not null default '', prompt text not null default '', metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz, created_at timestamptz not null default now(), unique(workspace_id, object_path)
);
create index if not exists generated_assets_owner_idx on generated_assets(workspace_id, created_by, created_at desc) where deleted_at is null;
alter table generated_assets add column if not exists retention_until timestamptz;
alter table generated_assets add column if not exists purge_after timestamptz;
alter table generated_assets add column if not exists retention_state text not null default 'active' check (retention_state in ('active','soft_deleted','purged'));
alter table generated_assets add column if not exists updated_at timestamptz not null default now();
alter table generated_assets alter column retention_until set default (now() + interval '3 days');
create index if not exists generated_assets_retention_idx on generated_assets(retention_state, purge_after) where retention_state <> 'purged';
create index if not exists generated_assets_active_retention_idx on generated_assets(retention_until) where retention_state = 'active';

create table if not exists gallery_items (
  id uuid primary key default gen_random_uuid(), asset_id uuid not null unique references generated_assets(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade, owner_id uuid not null references app_users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','published','hidden','removed')), featured boolean not null default false,
  like_count integer not null default 0, comment_count integer not null default 0, published_at timestamptz, deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists gallery_public_feed_idx on gallery_items(featured desc, published_at desc) where status = 'published' and deleted_at is null;
create table if not exists gallery_likes (
  gallery_id uuid not null references gallery_items(id) on delete cascade, user_id uuid not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(gallery_id, user_id)
);
create table if not exists gallery_comments (
  id uuid primary key default gen_random_uuid(), gallery_id uuid not null references gallery_items(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade, body text not null, request_id uuid not null,
  status text not null default 'visible' check (status in ('visible','hidden','removed')), created_at timestamptz not null default now(), unique(user_id, request_id)
);
create table if not exists asset_favorites (
  asset_id uuid not null references generated_assets(id) on delete cascade, user_id uuid not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(asset_id, user_id)
);

create table if not exists prompt_entries (
  id uuid primary key default gen_random_uuid(), workspace_id uuid references workspaces(id) on delete cascade,
  created_by uuid references app_users(id) on delete set null, title text not null, prompt text not null, category text not null default '',
  tags text[] not null default '{}', published boolean not null default false, favorite_count integer not null default 0,
  view_count integer not null default 0, deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists prompt_favorites (
  prompt_id uuid not null references prompt_entries(id) on delete cascade, user_id uuid not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(prompt_id, user_id)
);
alter table prompt_entries add column if not exists source text;
alter table prompt_entries add column if not exists source_key text;
alter table prompt_entries add column if not exists source_url text;
alter table prompt_entries add column if not exists license text;
create unique index if not exists prompt_entries_source_key_idx on prompt_entries(source, source_key) where source is not null and source_key is not null;

create table if not exists membership_entitlements (
  workspace_id uuid primary key references workspaces(id) on delete cascade, plan text not null default 'free',
  status text not null default 'inactive' check (status in ('inactive','active','past_due','cancelled','expired')),
  starts_at timestamptz, expires_at timestamptz, metadata jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);

create table if not exists generated_assets (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null, created_by uuid references app_users(id) on delete set null,
  source_job_id uuid references background_jobs(id) on delete set null, parent_asset_id uuid references generated_assets(id) on delete set null,
  media_type text not null check (media_type in ('image','video')), object_path text not null, mime_type text,
  title text not null default '', description text not null default '', prompt text not null default '', metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz, created_at timestamptz not null default now(), unique(workspace_id, object_path)
);
create table if not exists gallery_items (id uuid primary key default gen_random_uuid(), asset_id uuid not null unique references generated_assets(id) on delete cascade, workspace_id uuid not null references workspaces(id) on delete cascade, owner_id uuid not null references app_users(id) on delete cascade, status text not null default 'draft', featured boolean not null default false, like_count integer not null default 0, comment_count integer not null default 0, published_at timestamptz, deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists gallery_likes (gallery_id uuid not null references gallery_items(id) on delete cascade, user_id uuid not null references app_users(id) on delete cascade, created_at timestamptz not null default now(), primary key(gallery_id,user_id));
create table if not exists gallery_comments (id uuid primary key default gen_random_uuid(), gallery_id uuid not null references gallery_items(id) on delete cascade, user_id uuid not null references app_users(id) on delete cascade, body text not null, request_id uuid not null, status text not null default 'visible', created_at timestamptz not null default now(), unique(user_id,request_id));
create table if not exists asset_favorites (asset_id uuid not null references generated_assets(id) on delete cascade, user_id uuid not null references app_users(id) on delete cascade, created_at timestamptz not null default now(), primary key(asset_id,user_id));
create table if not exists prompt_entries (id uuid primary key default gen_random_uuid(), workspace_id uuid references workspaces(id) on delete cascade, created_by uuid references app_users(id) on delete set null, title text not null, prompt text not null, category text not null default '', tags text[] not null default '{}', published boolean not null default false, favorite_count integer not null default 0, view_count integer not null default 0, deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists prompt_favorites (prompt_id uuid not null references prompt_entries(id) on delete cascade, user_id uuid not null references app_users(id) on delete cascade, created_at timestamptz not null default now(), primary key(prompt_id,user_id));

-- Social content operations. Media files remain in generated_assets; these tables preserve the operating workflow.
create table if not exists trend_sources (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade, name text not null, platform text not null, source_type text not null check(source_type in('rss','api')), url text not null, config jsonb not null default '{}'::jsonb, enabled boolean not null default true, refresh_minutes integer not null default 60, last_synced_at timestamptz, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists trend_items (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade, source_id uuid references trend_sources(id) on delete set null, external_id text, platform text not null, title text not null, summary text not null default '', source_url text, heat numeric(14,4), tags text[] not null default '{}', dedupe_key text not null, published_at timestamptz, fetched_at timestamptz not null default now(), ignored_at timestamptz, favorited_at timestamptz, unique(workspace_id,dedupe_key));
create index if not exists trend_items_feed_idx on trend_items(workspace_id,fetched_at desc);
create table if not exists content_packages (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade, created_by uuid not null references app_users(id), trend_item_id uuid references trend_items(id) on delete set null, title text not null, topic text not null default '', brief text not null, goal text not null, content_type text not null, platforms text[] not null, duration_seconds integer not null, workflow_mode text not null check(workflow_mode in('review','automatic')), status text not null default 'draft' check(status in('draft','structured','approved','rendering','failed','ready','scheduled','exported','published','measured','analyzed')), model_id text, estimated_cost_cny numeric(14,4), actual_cost_cny numeric(14,4), max_cost_cny numeric(14,4), structure jsonb, version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists content_packages_workspace_idx on content_packages(workspace_id,updated_at desc);
create table if not exists content_variants (id uuid primary key default gen_random_uuid(), package_id uuid not null references content_packages(id) on delete cascade, platform text not null, version integer not null default 1, title text not null, body text not null default '', hashtags text[] not null default '{}', cover_text text not null default '', locked boolean not null default false, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(package_id,platform,version));
create table if not exists content_artifacts (id uuid primary key default gen_random_uuid(), package_id uuid not null references content_packages(id) on delete cascade, variant_id uuid references content_variants(id) on delete set null, asset_id uuid references generated_assets(id) on delete set null, artifact_type text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table if not exists publishing_accounts (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade, platform text not null, alias text not null, notes text not null default '', created_by uuid not null references app_users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,platform,alias));
create table if not exists social_oauth_states (state text primary key, user_id uuid not null references app_users(id) on delete cascade, platform text not null, expires_at timestamptz not null, created_at timestamptz not null default now());
create index if not exists social_oauth_states_expiry_idx on social_oauth_states(expires_at);
create table if not exists publishing_plans (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade, package_id uuid not null references content_packages(id) on delete cascade, variant_id uuid references content_variants(id) on delete set null, platform text not null, account_alias text not null, scheduled_at timestamptz not null, status text not null default 'scheduled', external_url text, published_at timestamptz, created_by uuid not null references app_users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists publishing_plans_due_idx on publishing_plans(workspace_id,status,scheduled_at);
create table if not exists post_metrics (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade, package_id uuid not null references content_packages(id) on delete cascade, publishing_plan_id uuid references publishing_plans(id) on delete set null, variant_id uuid references content_variants(id) on delete set null, platform text not null, account_alias text not null, post_url text not null, published_at timestamptz not null, impressions bigint not null default 0, views bigint not null default 0, completions bigint not null default 0, likes bigint not null default 0, comments bigint not null default 0, shares bigint not null default 0, saves bigint not null default 0, clicks bigint not null default 0, leads bigint not null default 0, conversions bigint not null default 0, spend_cny numeric(14,4) not null default 0, revenue_cny numeric(14,4) not null default 0, raw jsonb not null default '{}'::jsonb, recorded_at timestamptz not null default now(), unique(workspace_id,platform,account_alias,post_url));
create table if not exists content_insights (id uuid primary key default gen_random_uuid(), package_id uuid not null references content_packages(id) on delete cascade, summary text not null, metrics jsonb not null default '{}'::jsonb, recommendations jsonb not null default '[]'::jsonb, created_at timestamptz not null default now());

create table if not exists feed_automation_runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by uuid not null references app_users(id) on delete cascade, package_id uuid not null references content_packages(id) on delete cascade,
  structure_job_id uuid references background_jobs(id) on delete set null, idempotency_key text not null,
  status text not null default 'queued' check (status in ('queued','running','draft_ready','failed')),
  current_stage text not null default 'strategy', error_code text, error_message text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id, idempotency_key)
);
create index if not exists feed_automation_runs_workspace_idx on feed_automation_runs(workspace_id, updated_at desc);

create table if not exists agent_workflow_plans (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by uuid not null references app_users(id) on delete cascade, goal text not null,
  status text not null default 'planned' check (status in ('planned','running','paused','completed','failed')),
  plan jsonb not null default '{}'::jsonb, idempotency_key text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id, idempotency_key)
);
alter table agent_workflow_plans drop constraint if exists agent_workflow_plans_status_check;
alter table agent_workflow_plans add constraint agent_workflow_plans_status_check check (status in ('planned','running','paused','completed','failed'));
create index if not exists agent_workflow_plans_workspace_idx on agent_workflow_plans(workspace_id, updated_at desc);

create table if not exists publishing_platform_policies (
  platform text primary key,
  display_name text not null,
  default_mode text not null check (default_mode in ('oauth_api','extension','scan_confirm','deep_link')),
  supported_modes text[] not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into publishing_platform_policies(platform,display_name,default_mode,supported_modes,config) values
('douyin','抖音','scan_confirm',array['oauth_api','scan_confirm','deep_link'], '{"oauthConfigured":false}'),
('xiaohongshu','小红书','scan_confirm',array['scan_confirm','extension'], '{"extensionConfigured":false}'),
('kuaishou','快手','scan_confirm',array['scan_confirm','deep_link'], '{}'),
('zhihu','知乎','scan_confirm',array['deep_link','scan_confirm'], '{}'),
('bilibili','B站','scan_confirm',array['oauth_api','scan_confirm'], '{"oauthConfigured":false}'),
('wechat_channels','视频号','scan_confirm',array['scan_confirm','extension'], '{"extensionConfigured":false}'),
('wechat_official','公众号','scan_confirm',array['oauth_api','scan_confirm'], '{"oauthConfigured":false}'),
('tiktok','TikTok','scan_confirm',array['oauth_api','scan_confirm','deep_link'], '{"oauthConfigured":false,"region":"global"}'),
('instagram','Instagram','scan_confirm',array['oauth_api','scan_confirm','deep_link'], '{"oauthConfigured":false,"region":"global"}'),
('facebook','Facebook','scan_confirm',array['oauth_api','scan_confirm','deep_link'], '{"oauthConfigured":false,"region":"global"}'),
('youtube','YouTube','scan_confirm',array['oauth_api','scan_confirm','deep_link'], '{"oauthConfigured":false,"region":"global"}'),
('pinterest','Pinterest','scan_confirm',array['oauth_api','scan_confirm','deep_link'], '{"oauthConfigured":false,"region":"global"}'),
('x','X','scan_confirm',array['oauth_api','scan_confirm','deep_link'], '{}')
on conflict(platform) do nothing;

alter table publishing_accounts add column if not exists owner_user_id uuid references app_users(id) on delete cascade;
alter table publishing_accounts add column if not exists status text not null default 'active';
alter table publishing_accounts add column if not exists connection_mode text not null default 'scan_confirm';
alter table publishing_accounts add column if not exists external_account_id text;
alter table publishing_plans add column if not exists account_id uuid references publishing_accounts(id) on delete restrict;
alter table publishing_plans add column if not exists publish_mode text not null default 'scan_confirm';
alter table publishing_plans add column if not exists confirmed_at timestamptz;
alter table publishing_plans add column if not exists result_json jsonb not null default '{}'::jsonb;
alter table publishing_plans add column if not exists attempt_count integer not null default 0;
alter table publishing_plans add column if not exists idempotency_key text;
alter table publishing_plans add column if not exists notification_sent_at timestamptz;
create unique index if not exists publishing_plans_idempotency_idx on publishing_plans(workspace_id,idempotency_key) where idempotency_key is not null;
create index if not exists publishing_plans_notification_idx on publishing_plans(status,scheduled_at) where notification_sent_at is null;
create table if not exists publishing_audit_logs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_id uuid references app_users(id) on delete set null, plan_id uuid references publishing_plans(id) on delete cascade,
  account_id uuid references publishing_accounts(id) on delete set null, action text not null,
  before_status text, after_status text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists publishing_audit_plan_idx on publishing_audit_logs(workspace_id,plan_id,created_at desc);
