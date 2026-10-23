create table if not exists desktop_mcp_tool_calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  connection_id uuid not null references website_capture_connections(id) on delete cascade,
  server_id uuid not null,
  server_name text not null,
  tool_name text not null,
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  duration_ms integer,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists desktop_mcp_tool_calls_workspace_idx
  on desktop_mcp_tool_calls(workspace_id, created_at desc);
create index if not exists desktop_mcp_tool_calls_connection_idx
  on desktop_mcp_tool_calls(connection_id, created_at desc);
