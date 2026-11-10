create table if not exists project_video_documents (
  project_id uuid primary key references projects(id) on delete cascade,
  revision integer not null check (revision > 0),
  sync_enabled boolean not null,
  document jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists project_video_versions (
  project_id uuid not null references projects(id) on delete cascade,
  revision integer not null check (revision > 0),
  mutation_id uuid not null,
  fingerprint text not null,
  document jsonb not null,
  sync_enabled boolean not null,
  created_at timestamptz not null default now(),
  primary key(project_id,revision),
  unique(project_id,mutation_id)
);
