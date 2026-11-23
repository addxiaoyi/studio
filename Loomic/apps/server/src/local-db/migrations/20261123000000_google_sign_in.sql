create table if not exists google_login_states (
  state_hash text primary key,
  browser_hash text not null,
  nonce_hash text not null,
  code_verifier text not null,
  return_to text not null,
  link_user_id uuid references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists google_login_states_expiry_idx on google_login_states(expires_at);

create table if not exists google_identities (
  subject text primary key,
  user_id uuid not null unique references app_users(id) on delete cascade,
  email_at_link text not null,
  created_at timestamptz not null default now()
);
