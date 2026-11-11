create table if not exists project_creation_requests (
  user_id text not null,
  request_key text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_key)
);
