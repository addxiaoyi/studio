alter table desktop_agent_tasks
  add column if not exists max_duration_seconds integer not null default 300
    check (max_duration_seconds between 10 and 1800);

create index if not exists desktop_agent_connection_status_idx
  on desktop_agent_tasks(connection_id, status, updated_at desc);
