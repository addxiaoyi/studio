create table if not exists official_model_prices (
  price_key text primary key,
  provider_key text not null,
  provider_label text not null,
  model_id text not null,
  model_name text not null,
  media_type text not null check (media_type in ('image', 'video')),
  variant text not null,
  official_min numeric(14,6) not null check (official_min >= 0),
  official_max numeric(14,6) not null check (official_max >= official_min),
  currency text not null default 'USD' check (currency = 'USD'),
  billing_unit text not null check (billing_unit in ('per_image', 'per_second', 'per_million_tokens')),
  unit_label text not null,
  helstera_credits numeric(14,4) not null check (helstera_credits >= 0),
  helstera_unit_label text not null,
  note text,
  source_id text not null,
  source_label text not null,
  source_url text not null,
  snapshot_date date not null,
  last_verified_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table official_model_prices drop constraint if exists official_model_prices_billing_unit_check;
alter table official_model_prices add constraint official_model_prices_billing_unit_check
  check (billing_unit in ('per_image', 'per_second', 'per_million_tokens'));

create index if not exists official_model_prices_catalog_idx
  on official_model_prices(media_type, provider_key, model_name);

create table if not exists official_model_price_sources (
  source_id text primary key,
  label text not null,
  source_url text not null,
  automatic boolean not null default true,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'snapshot')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  item_count integer not null default 0 check (item_count >= 0),
  last_error text
);
