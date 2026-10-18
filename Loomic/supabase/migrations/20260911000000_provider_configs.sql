create table if not exists public.provider_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  label text not null,
  base_url text not null,
  key_ciphertext text not null,
  key_last4 text not null,
  enabled boolean not null default true,
  health_status text not null default 'unknown',
  models jsonb not null default '[]'::jsonb,
  failure_count integer not null default 0,
  latency_ms integer,
  last_error text,
  last_probed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.provider_configs enable row level security;
create policy provider_configs_members on public.provider_configs for select using (exists (select 1 from public.workspace_members wm where wm.workspace_id = provider_configs.workspace_id and wm.user_id = auth.uid() and wm.role in ('owner','admin')));
create policy provider_configs_admins on public.provider_configs for all using (exists (select 1 from public.workspace_members wm where wm.workspace_id = provider_configs.workspace_id and wm.user_id = auth.uid() and wm.role in ('owner','admin')));
