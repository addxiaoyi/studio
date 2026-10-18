alter table if exists generated_assets add column if not exists retention_until timestamptz;
alter table if exists generated_assets add column if not exists purge_after timestamptz;
alter table if exists generated_assets add column if not exists retention_state text not null default 'active';
alter table if exists generated_assets add column if not exists updated_at timestamptz not null default now();
alter table if exists generated_assets drop constraint if exists generated_assets_retention_state_check;
alter table if exists generated_assets add constraint generated_assets_retention_state_check check (retention_state in ('active','soft_deleted','purged'));
create index if not exists generated_assets_retention_idx on generated_assets(retention_state, purge_after) where retention_state <> 'purged';

create table if not exists feed_automation_runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, created_by uuid not null,
  package_id uuid not null, structure_job_id uuid, idempotency_key text not null,
  status text not null default 'queued', current_stage text not null default 'strategy',
  error_code text, error_message text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id, idempotency_key)
);
create index if not exists feed_automation_runs_workspace_idx on feed_automation_runs(workspace_id, updated_at desc);

create table if not exists agent_workflow_plans (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, created_by uuid not null,
  goal text not null, status text not null default 'planned', plan jsonb not null default '{}'::jsonb,
  idempotency_key text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id, idempotency_key)
);
alter table agent_workflow_plans drop constraint if exists agent_workflow_plans_status_check;
alter table agent_workflow_plans add constraint agent_workflow_plans_status_check check (status in ('planned','running','paused','completed','failed'));
create index if not exists agent_workflow_plans_workspace_idx on agent_workflow_plans(workspace_id, updated_at desc);
