create table if not exists public.agent_marketplace_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('skill', 'mcp', 'plugin')),
  name text not null,
  slug text not null unique,
  description text not null default '',
  source_url text not null,
  version text not null default '1.0.0',
  license text,
  manifest jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'published', 'hidden')),
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_marketplace_items_browse_idx
  on public.agent_marketplace_items(kind, status, updated_at desc);

create table if not exists public.agent_marketplace_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.agent_marketplace_items(id) on delete cascade,
  version text not null,
  source_url text not null,
  license text,
  manifest jsonb not null default '{}'::jsonb,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(item_id, version)
);

alter table public.agent_marketplace_items enable row level security;

drop policy if exists agent_marketplace_items_read_published on public.agent_marketplace_items;
create policy agent_marketplace_items_read_published
  on public.agent_marketplace_items for select to authenticated
  using (status = 'published');

drop policy if exists agent_marketplace_items_service on public.agent_marketplace_items;
create policy agent_marketplace_items_service
  on public.agent_marketplace_items for all to service_role
  using (true) with check (true);

insert into public.agent_marketplace_items
  (kind, name, slug, description, source_url, version, license, manifest, status)
values
  ('mcp', 'Playwright MCP', 'playwright-mcp', 'Microsoft official browser automation through the accessibility tree.', 'https://github.com/microsoft/playwright-mcp', 'latest', 'Apache-2.0', '{"transport":"stdio","command":"npx","args":["@playwright/mcp@latest"]}', 'published'),
  ('mcp', 'MCP Reference Servers', 'mcp-reference-servers', 'Official reference servers maintained by the Model Context Protocol project.', 'https://github.com/modelcontextprotocol/servers', 'latest', 'MIT', '{"catalog":true}', 'published'),
  ('skill', 'Frontend Design', 'frontend-design', 'Anthropic official frontend design skill.', 'https://github.com/anthropics/skills/tree/main/skills/frontend-design', 'main', 'Apache-2.0', '{"source":"github"}', 'published'),
  ('skill', 'Web App Testing', 'webapp-testing', 'Anthropic official web application testing skill.', 'https://github.com/anthropics/skills/tree/main/skills/webapp-testing', 'main', 'Apache-2.0', '{"source":"github"}', 'published')
on conflict (slug) do update set
  description = excluded.description,
  source_url = excluded.source_url,
  version = excluded.version,
  license = excluded.license,
  manifest = excluded.manifest,
  status = excluded.status,
  updated_at = now();

insert into public.agent_marketplace_versions(item_id, version, source_url, license, manifest)
select id, version, source_url, license, manifest from public.agent_marketplace_items
on conflict (item_id, version) do nothing;
