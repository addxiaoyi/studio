-- Keep list reads off the multi-megabyte payload.
-- Image jobs embed inline base64 reference images in payload.input_images.
-- Selecting that column for the list endpoint handed Node ~45 MB of JSON to parse
-- per call while PostgreSQL itself answered in under 1ms, so the list now reads
-- a pre-computed, elided summary instead.
alter table background_jobs add column if not exists payload_summary jsonb;

update background_jobs
set payload_summary = case
  when payload is null then null
  else jsonb_build_object(
    'prompt', payload->'prompt',
    'model', payload->'model',
    'title', payload->'title',
    'routing', payload->'routing',
    'input_asset_ids', payload->'input_asset_ids',
    'input_images', case
      when jsonb_typeof(payload->'input_images') = 'array'
        then to_jsonb(array_fill('[inline image elided]'::text, array[jsonb_array_length(payload->'input_images')]))
      else payload->'input_images'
    end
  )
end
where payload_summary is null;
