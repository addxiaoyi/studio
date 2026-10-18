alter table publishing_plans add column if not exists notification_sent_at timestamptz;
create index if not exists publishing_plans_notification_idx
  on publishing_plans(status, scheduled_at)
  where notification_sent_at is null;
