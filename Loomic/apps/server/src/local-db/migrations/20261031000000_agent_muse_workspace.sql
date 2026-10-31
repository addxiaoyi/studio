alter table agent_goals
  add column if not exists output_kind text not null default 'auto',
  add column if not exists source text not null default 'user',
  add column if not exists execution_policy text not null default 'approval_required',
  add column if not exists parent_goal_id uuid references agent_goals(id) on delete set null,
  add column if not exists connection_ids jsonb not null default '[]'::jsonb,
  add column if not exists memory_context_ids jsonb not null default '[]'::jsonb,
  add column if not exists suggestion_state text not null default 'none',
  add column if not exists confirmed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_goals_output_kind_check') then
    alter table agent_goals add constraint agent_goals_output_kind_check
      check (output_kind in ('auto','canvas','document','image','video','bundle'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_goals_source_check') then
    alter table agent_goals add constraint agent_goals_source_check
      check (source in ('user','suggestion','scheduled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_goals_execution_policy_check') then
    alter table agent_goals add constraint agent_goals_execution_policy_check
      check (execution_policy in ('approval_required','suggest_only'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_goals_suggestion_state_check') then
    alter table agent_goals add constraint agent_goals_suggestion_state_check
      check (suggestion_state in ('none','suggested','accepted','dismissed'));
  end if;
end $$;

create index if not exists agent_goals_parent_idx on agent_goals(parent_goal_id) where parent_goal_id is not null;
create index if not exists agent_goals_suggestion_idx on agent_goals(created_by, suggestion_state, updated_at desc);

create table if not exists agent_memories (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  kind text not null check (kind in ('preference','workflow','goal','connection','storage')),
  key text not null,
  value text not null,
  source text,
  confidence numeric(4,3) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  enabled boolean not null default true,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, kind, key)
);

create index if not exists agent_memories_owner_idx
  on agent_memories(workspace_id, user_id, enabled, updated_at desc);

create table if not exists agent_memory_events (
  id bigserial primary key,
  memory_id uuid not null references agent_memories(id) on delete cascade,
  event_type text not null,
  source_type text,
  source_id text,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists agent_memory_events_memory_idx
  on agent_memory_events(memory_id, created_at desc);

create table if not exists agent_suggestions (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  canvas_id uuid references canvases(id) on delete set null,
  chat_session_id uuid references chat_sessions(id) on delete set null,
  kind text not null check (kind in ('goal','memory','workflow')),
  title text not null,
  detail text not null,
  goal text,
  source_memory_ids jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','accepted','dismissed','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists agent_suggestions_owner_idx
  on agent_suggestions(workspace_id, user_id, status, created_at desc);

create table if not exists agent_connector_permissions (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  connector_id text not null,
  enabled boolean not null default false,
  permissions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, connector_id)
);

create table if not exists agent_goal_outputs (
  id uuid primary key,
  goal_id uuid not null references agent_goals(id) on delete cascade,
  kind text not null,
  local_path text,
  cloud_asset_id uuid,
  status text not null default 'pending' check (status in ('pending','saved_local','saved_cloud','saved_both','failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_goal_outputs_goal_idx
  on agent_goal_outputs(goal_id, created_at asc);
