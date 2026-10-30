alter table desktop_agent_tasks
  alter column connection_id drop not null;

create index if not exists desktop_agent_tasks_background_idx
  on desktop_agent_tasks(goal_id, status, updated_at desc)
  where goal_id is not null and connection_id is null;
