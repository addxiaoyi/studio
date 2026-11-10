create table if not exists media_resource_leases (
  id uuid primary key,
  disk_key text not null,
  kind text not null check (kind in ('capture', 'transcode')),
  reserved_bytes bigint not null check (reserved_bytes > 0),
  lease_until timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists media_resource_leases_disk_idx on media_resource_leases(disk_key, lease_until);
