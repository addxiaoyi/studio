update public.provider_configs pc
set models=coalesce((
  select jsonb_agg(model_value order by ordinal)
  from jsonb_array_elements(pc.models) with ordinality as item(model_value, ordinal)
  where lower(trim(both '"' from model_value::text)) !~ '(^|[/ :])gpt-image-1[.]5$'
),'[]'::jsonb), updated_at=now()
where jsonb_typeof(pc.models)='array' and exists (
  select 1 from jsonb_array_elements_text(pc.models) as configured(model_id)
  where lower(configured.model_id) ~ '(^|[/ :])gpt-image-1[.]5$'
);