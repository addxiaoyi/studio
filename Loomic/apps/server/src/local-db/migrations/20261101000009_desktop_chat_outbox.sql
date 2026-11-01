create table if not exists desktop_agent_chat_outbox (
  task_id uuid not null references desktop_agent_tasks(id) on delete cascade,
  status text not null check (status in ('succeeded', 'failed', 'canceled')),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  goal text not null,
  summary text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  primary key (task_id, status)
);

create index if not exists desktop_agent_chat_outbox_pending_idx
  on desktop_agent_chat_outbox(created_at) where delivered_at is null;

create or replace function enqueue_desktop_agent_terminal_chat() returns trigger language plpgsql as $$
begin
  if new.status in ('succeeded', 'failed', 'canceled')
     and old.status is distinct from new.status
     and new.connection_id is not null and new.chat_session_id is not null then
    insert into desktop_agent_chat_outbox(task_id,status,session_id,user_id,goal,summary)
      values(new.id,new.status,new.chat_session_id,new.created_by,new.goal,
             left(coalesce(new.result->>'summary',new.error_message),8000))
      on conflict (task_id,status) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists desktop_agent_terminal_chat_outbox on desktop_agent_tasks;
create trigger desktop_agent_terminal_chat_outbox
  after update of status on desktop_agent_tasks
  for each row execute function enqueue_desktop_agent_terminal_chat();
