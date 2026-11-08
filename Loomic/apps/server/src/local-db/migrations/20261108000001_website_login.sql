alter table website_capture_tasks add column if not exists login jsonb;
create table if not exists website_login_secrets (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  task_id uuid unique references website_capture_tasks(id) on delete cascade,
  settings jsonb not null,
  ciphertext text,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists website_login_expiry on website_login_secrets(expires_at) where ciphertext is not null;
