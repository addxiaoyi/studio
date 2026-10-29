-- Keep list reads off the multi-megabyte payload (see the local migration of the
-- same version). Image jobs embed inline base64 reference images in
-- payload.input_images; the job list reads payload_summary instead.
alter table public.background_jobs add column if not exists payload_summary jsonb;

update public.background_jobs
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
