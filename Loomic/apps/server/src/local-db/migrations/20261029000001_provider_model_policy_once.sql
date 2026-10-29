-- Product-policy model state, moved out of schema.sql.
--
-- These were `update` statements living in schema.sql, and schema.sql is replayed
-- unconditionally on every deploy (apps/server/src/local-db/migrate.ts). That meant every
-- single release silently:
--   * cleared provider_models.failure_count / cooldown_until (circuit breaker reset),
--   * re-enabled models that operations had switched off,
--   * forced price_credits back to the hardcoded 0.432, discarding any pricing change.
--
-- A migration is applied once and tracked by checksum in schema_migrations, so the policy
-- is still applied to fresh databases but no longer re-applied on every release.

update workspace_settings set default_model='auto' where lower(default_model) in ('agnes-3.0-flash','openai:agnes-3.0-flash');
update workspace_settings set chat_model='auto' where lower(chat_model) in ('agnes-3.0-flash','openai:agnes-3.0-flash');

update provider_models set enabled=false, health_status='degraded', last_error='model_removed_by_product_policy', updated_at=now() where lower(model_id)='agnes-3.0-flash';
update provider_configs pc set models=coalesce((select jsonb_agg(model_value order by ordinal) from jsonb_array_elements(pc.models) with ordinality as item(model_value, ordinal) where lower(trim(both '"' from model_value::text)) <> 'agnes-3.0-flash'),'[]'::jsonb), updated_at=now() where jsonb_typeof(pc.models)='array' and exists (select 1 from jsonb_array_elements_text(pc.models) configured(model_id) where lower(configured.model_id)='agnes-3.0-flash');

update provider_models set enabled=true, health_status='unknown', failure_count=0, last_error=null, cooldown_until=null, updated_at=now() where lower(model_id)='minimax-h3';
update provider_models set enabled=true, health_status='unknown', failure_count=0, last_error=null, cooldown_until=null, updated_at=now() where lower(model_id) in ('hailuo-h3','hailuo-h3-cankaosheng','hailuo-h3-max','hailuo-h3-max-shouweizhen','hailuo-h3-quannengcankao','hailuo-h3-shouweizhen','hailuo-h3-zaishengcheng','happyhorse-1.1-i2v','happyhorse-1.1-r2v','kling-avatar-image2video','kling-motion-control','kling-motion-control-v3','minimax-h3-max');
update provider_models set enabled=false, health_status='degraded', last_error='token_billing_disabled_by_product_policy', updated_at=now() where billing_unit='per_million_tokens';

update provider_models set price_credits=0.432, updated_at=now() where lower(model_id) in ('minimax-h3','hailuo-h3','hailuo-h3-cankaosheng','hailuo-h3-max','hailuo-h3-max-shouweizhen','hailuo-h3-quannengcankao','hailuo-h3-shouweizhen','kling-motion-control','kling-motion-control-v3');
update provider_models set price_credits=0.432, updated_at=now() where lower(model_id)='kling-avatar-image2video';

update provider_models
set enabled=false, health_status='degraded', last_error='model_removed_by_product_policy', updated_at=now()
where lower(model_id) ~ '(^|[/ :])gpt-image-1[.]5$';

update provider_configs pc
set models=coalesce((
  select jsonb_agg(model_value order by ordinal)
  from jsonb_array_elements(pc.models) with ordinality as item(model_value, ordinal)
  where lower(trim(both '"' from model_value::text)) !~ '(^|[/ :])gpt-image-1[.]5$'
),'[]'::jsonb), updated_at=now()
where jsonb_typeof(pc.models)='array' and exists (
  select 1 from jsonb_array_elements_text(pc.models) as configured(model_id)
  where lower(configured.model_id) ~ '(^|[/ :])gpt-image-1[.]5$'
);
