alter table agent_goals
  add column if not exists next_attempt_at timestamptz;

create index if not exists agent_goals_retry_idx
  on agent_goals(next_attempt_at, updated_at)
  where status='waiting_desktop';
