alter table gallery_items add column if not exists caption_snapshot jsonb;
alter table gallery_items drop constraint if exists gallery_caption_snapshot_object;
alter table gallery_items add constraint gallery_caption_snapshot_object
  check (caption_snapshot is null or jsonb_typeof(caption_snapshot) = 'object');
