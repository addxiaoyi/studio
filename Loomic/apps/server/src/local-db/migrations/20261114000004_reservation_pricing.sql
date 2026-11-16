alter table background_jobs add column if not exists billing_pricing jsonb;

create or replace function preserve_reservation_pricing() returns trigger language plpgsql as $$
begin
  if old.billing_pricing is not null and old.billing_pricing is distinct from new.billing_pricing then
    raise exception 'reservation_pricing_is_immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists reservation_pricing_immutable on background_jobs;
create trigger reservation_pricing_immutable before update of billing_pricing on background_jobs
  for each row execute function preserve_reservation_pricing();
