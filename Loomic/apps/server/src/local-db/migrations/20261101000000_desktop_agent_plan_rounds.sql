create table if not exists desktop_agent_plan_rounds (
  task_id uuid not null references desktop_agent_tasks(id) on delete cascade,
  round integer not null check (round between 1 and 5),
  observation_hash text not null check (observation_hash ~ '^[0-9a-f]{64}$'),
  actions jsonb not null check (jsonb_typeof(actions) = 'array'),
  created_at timestamptz not null default now(),
  primary key (task_id, round)
);
