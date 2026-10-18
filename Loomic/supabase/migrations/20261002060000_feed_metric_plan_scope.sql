alter table post_metrics
  add column if not exists publishing_plan_id uuid references publishing_plans(id) on delete set null;
create index if not exists post_metrics_plan_idx on post_metrics(publishing_plan_id);