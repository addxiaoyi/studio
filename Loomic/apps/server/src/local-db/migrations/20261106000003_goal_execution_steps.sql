create table if not exists agent_goal_steps (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references agent_goals(id) on delete cascade,
  step_id text not null,
  ordinal integer not null,
  title text not null,
  executor text not null,
  command jsonb not null,
  depends_on jsonb not null default '[]',
  completion text not null,
  state text not null default 'queued' check(state in ('queued','running','waiting_approval','waiting_desktop','review','succeeded','failed','canceled')),
  attempt integer not null default 0,
  fingerprint text not null,
  approval text not null default 'not_required' check(approval in ('not_required','pending','approved','consumed','rejected','expired')),
  approval_expires_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(goal_id,step_id), unique(goal_id,ordinal)
);
create index if not exists agent_goal_steps_queue on agent_goal_steps(state,lease_until,updated_at);
