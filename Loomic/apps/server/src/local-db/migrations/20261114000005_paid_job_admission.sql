alter table background_jobs add column if not exists billing_required boolean not null default false;
