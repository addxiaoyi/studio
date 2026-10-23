alter table generated_assets
  alter column retention_until set default (now() + interval '3 days');

create index if not exists generated_assets_active_retention_idx
  on generated_assets(retention_until)
  where retention_state = 'active';

-- Give existing cloud-only assets a three-day local-save window after rollout.
update generated_assets
set retention_until = now() + interval '3 days',
    updated_at = now()
where retention_state = 'active'
  and deleted_at is null;
