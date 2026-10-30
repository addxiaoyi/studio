create table if not exists agent_goals (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by uuid not null references app_users(id) on delete cascade,
  canvas_id uuid references canvases(id) on delete set null,
  chat_session_id uuid references chat_sessions(id) on delete set null,
  goal text not null,
  status text not null default 'draft' check (status in ('draft','running','waiting_approval','waiting_desktop','paused','completed','failed','canceled')),
  plan jsonb not null default '{"steps":[],"generatedAt":"1970-01-01T00:00:00.000Z"}'::jsonb,
  execution_mode text not null default 'automatic' check (execution_mode in ('automatic','isolated_browser','connected_browser_tab','windows_ui','visual_ocr')),
  capabilities jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  idempotency_key text not null,
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists agent_goals_idempotency_idx
  on agent_goals(workspace_id, created_by, idempotency_key);
create index if not exists agent_goals_canvas_idx
  on agent_goals(canvas_id, created_at desc)
  where canvas_id is not null;
create index if not exists agent_goals_owner_idx
  on agent_goals(created_by, updated_at desc);

alter table desktop_agent_tasks
  add column if not exists goal_id uuid references agent_goals(id) on delete set null,
  add column if not exists parent_task_id uuid references desktop_agent_tasks(id) on delete set null,
  add column if not exists checkpoint jsonb,
  add column if not exists resume_token text,
  add column if not exists wait_reason text,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists last_event_id bigint;

alter table desktop_agent_tasks drop constraint if exists desktop_agent_tasks_status_check;
alter table desktop_agent_tasks add constraint desktop_agent_tasks_status_check
  check (status in ('queued','running','waiting_approval','waiting_desktop','paused','succeeded','failed','canceled'));

create index if not exists desktop_agent_tasks_goal_idx
  on desktop_agent_tasks(goal_id, created_at desc)
  where goal_id is not null;

create table if not exists agent_goal_events (
  id bigserial primary key,
  goal_id uuid not null references agent_goals(id) on delete cascade,
  task_id uuid references desktop_agent_tasks(id) on delete cascade,
  event_type text not null,
  detail text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_goal_events_goal_idx
  on agent_goal_events(goal_id, created_at desc);

create or replace function mirror_desktop_agent_event_to_goal()
returns trigger
language plpgsql
as $$
begin
  insert into agent_goal_events(goal_id, task_id, event_type, detail, payload, created_at)
  select t.goal_id, new.task_id, new.event_type, new.detail, new.payload, new.created_at
    from desktop_agent_tasks t
   where t.id = new.task_id and t.goal_id is not null;
  update desktop_agent_tasks
     set last_event_id = new.id, updated_at = greatest(updated_at, new.created_at)
   where id = new.task_id;
  return new;
end;
$$;

drop trigger if exists desktop_agent_event_goal_mirror on desktop_agent_events;
create trigger desktop_agent_event_goal_mirror
after insert on desktop_agent_events
for each row execute function mirror_desktop_agent_event_to_goal();
