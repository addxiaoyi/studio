alter table email_verification_codes
  add column if not exists attempts integer not null default 0;
