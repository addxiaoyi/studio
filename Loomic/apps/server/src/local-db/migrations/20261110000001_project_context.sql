create table if not exists project_user_contexts (
  user_id uuid not null references app_users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  canvas_id uuid not null references canvases(id) on delete cascade,
  session_id uuid references chat_sessions(id) on delete set null,
  view text not null check (view in ('canvas','workflow','timeline','video','conversation')),
  composition_id text,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, project_id)
);
create index if not exists project_user_contexts_recent_idx on project_user_contexts(user_id, updated_at desc);
