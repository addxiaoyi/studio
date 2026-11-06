create table if not exists video_transcripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  request_key uuid not null,
  source_name text not null,
  source_path text not null,
  source_sha256 text not null,
  mime_type text not null,
  model text not null,
  language text not null,
  state text not null default 'queued' check (state in ('queued','running','completed','failed','canceled','expired')),
  progress integer not null default 0 check (progress between 0 and 100),
  transcript jsonb,
  edit jsonb,
  revision integer not null default 0,
  error text,
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 days',
  cleaned_at timestamptz,
  unique(user_id, request_key)
);
create index if not exists video_transcripts_queue on video_transcripts(state,lease_until,created_at);
create index if not exists video_transcripts_owner on video_transcripts(user_id,created_at desc);

create table if not exists video_transcript_exports (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references video_transcripts(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  request_key uuid not null,
  revision integer not null,
  fingerprint text not null,
  options jsonb not null,
  compiled jsonb not null,
  state text not null default 'pending' check (state in ('pending','queued','running','completed','failed','canceled')),
  progress integer not null default 0 check (progress between 0 and 100),
  output_path text,
  error text,
  lease_token uuid,
  lease_until timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  unique(user_id,request_key)
);
create index if not exists video_transcript_exports_queue on video_transcript_exports(state,lease_until,created_at);
