alter table public.provider_models add column if not exists health_status text not null default 'unknown';
alter table public.provider_models add column if not exists failure_count integer not null default 0;
alter table public.provider_models add column if not exists last_error text;
alter table public.provider_models add column if not exists last_failed_at timestamptz;
alter table public.provider_models add column if not exists last_succeeded_at timestamptz;
alter table public.provider_models add column if not exists cooldown_until timestamptz;

create index if not exists provider_models_health_idx
  on public.provider_models(model_id, enabled, health_status, cooldown_until, priority);
