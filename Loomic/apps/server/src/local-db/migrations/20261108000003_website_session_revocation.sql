alter table website_capture_tasks add column if not exists browser_session_id uuid references website_browser_sessions(id) on delete set null;
create index if not exists website_capture_session_active on website_capture_tasks(browser_session_id) where status in ('queued','running');
alter table agent_browser_views add column if not exists login_origins jsonb not null default '[]';
create table if not exists video_narration_requests (
 id uuid primary key,
 workspace_id uuid not null references workspaces(id) on delete cascade,
 user_id uuid not null references app_users(id) on delete cascade,
 text text not null,
 voice text not null,
 rate integer not null,
 fingerprint text not null,
 state text not null default 'pending' check(state in ('pending','running','succeeded','rejected','failed')),
 asset_id uuid references asset_objects(id),
 expires_at timestamptz not null default(now()+interval '15 minutes'),
 created_at timestamptz not null default now()
);
