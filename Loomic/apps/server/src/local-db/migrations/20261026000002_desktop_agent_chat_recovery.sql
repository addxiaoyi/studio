alter table desktop_agent_tasks
  add column if not exists chat_session_id uuid references chat_sessions(id) on delete set null;

create index if not exists desktop_agent_tasks_chat_session_idx
  on desktop_agent_tasks(chat_session_id, created_at desc)
  where chat_session_id is not null;
