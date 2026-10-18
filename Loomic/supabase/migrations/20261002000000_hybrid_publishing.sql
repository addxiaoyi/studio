create table if not exists publishing_platform_policies (
  platform text primary key,
  display_name text not null,
  default_mode text not null check (default_mode in ('oauth_api','extension','scan_confirm','deep_link')),
  supported_modes text[] not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into publishing_platform_policies(platform,display_name,default_mode,supported_modes,config) values
('douyin','抖音','scan_confirm',array['oauth_api','scan_confirm','deep_link'], '{"oauthConfigured":false}'),
('xiaohongshu','小红书','scan_confirm',array['scan_confirm','extension'], '{"extensionConfigured":false}'),
('kuaishou','快手','scan_confirm',array['scan_confirm','deep_link'], '{}'),
('zhihu','知乎','scan_confirm',array['deep_link','scan_confirm'], '{}'),
('bilibili','B站','scan_confirm',array['oauth_api','scan_confirm'], '{"oauthConfigured":false}'),
('wechat_channels','视频号','scan_confirm',array['scan_confirm','extension'], '{"extensionConfigured":false}'),
('wechat_official','公众号','scan_confirm',array['oauth_api','scan_confirm'], '{"oauthConfigured":false}'),
('tiktok','TikTok','scan_confirm',array['oauth_api','scan_confirm','deep_link'], '{"oauthConfigured":false,"region":"global"}'),
('instagram','Instagram','scan_confirm',array['oauth_api','scan_confirm','deep_link'], '{"oauthConfigured":false,"region":"global"}'),
('facebook','Facebook','scan_confirm',array['oauth_api','scan_confirm','deep_link'], '{"oauthConfigured":false,"region":"global"}'),
('youtube','YouTube','scan_confirm',array['oauth_api','scan_confirm','deep_link'], '{"oauthConfigured":false,"region":"global"}'),
('pinterest','Pinterest','scan_confirm',array['oauth_api','scan_confirm','deep_link'], '{"oauthConfigured":false,"region":"global"}'),
('x','X','scan_confirm',array['oauth_api','scan_confirm','deep_link'], '{}')
on conflict(platform) do nothing;

alter table publishing_accounts add column if not exists owner_user_id uuid references public.profiles(id) on delete cascade;
alter table publishing_accounts add column if not exists status text not null default 'active';
alter table publishing_accounts add column if not exists connection_mode text not null default 'scan_confirm';
alter table publishing_accounts add column if not exists external_account_id text;

alter table publishing_plans add column if not exists account_id uuid references publishing_accounts(id) on delete restrict;
alter table publishing_plans add column if not exists publish_mode text not null default 'scan_confirm';
alter table publishing_plans add column if not exists confirmed_at timestamptz;
alter table publishing_plans add column if not exists result_json jsonb not null default '{}'::jsonb;
alter table publishing_plans add column if not exists attempt_count integer not null default 0;
alter table publishing_plans add column if not exists idempotency_key text;
create unique index if not exists publishing_plans_idempotency_idx on publishing_plans(workspace_id,idempotency_key) where idempotency_key is not null;

create table if not exists publishing_audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  plan_id uuid references publishing_plans(id) on delete cascade,
  account_id uuid references publishing_accounts(id) on delete set null,
  action text not null,
  before_status text,
  after_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists publishing_audit_plan_idx on publishing_audit_logs(workspace_id,plan_id,created_at desc);
