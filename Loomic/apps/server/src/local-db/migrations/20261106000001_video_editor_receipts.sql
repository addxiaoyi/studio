alter table video_editor_plans add column if not exists editor_applied_at timestamptz;
alter table video_editor_plans add column if not exists export_receipt jsonb;
