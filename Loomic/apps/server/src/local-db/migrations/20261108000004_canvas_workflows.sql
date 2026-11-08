create table if not exists canvas_workflows (
  id uuid primary key default gen_random_uuid(),
  canvas_id uuid not null references canvases(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by uuid not null references app_users(id) on delete cascade,
  graph jsonb not null,
  revision integer not null default 1,
  active_goal_id uuid references agent_goals(id) on delete set null,
  request_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(canvas_id,created_by,request_key)
);
create index if not exists canvas_workflows_canvas_idx on canvas_workflows(canvas_id,created_by,updated_at desc);
create table if not exists canvas_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references canvas_workflows(id) on delete cascade,
  goal_id uuid not null references agent_goals(id) on delete cascade,
  revision integer not null,
  graph jsonb not null,
  request_key text not null,
  created_at timestamptz not null default now(),
  unique(workflow_id,request_key)
);
