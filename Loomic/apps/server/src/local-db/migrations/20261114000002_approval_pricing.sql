alter table generation_approvals add column if not exists billing_pricing jsonb;

-- Only prices captured while quoting are trustworthy; leave historical approvals unset.
create or replace function preserve_approval_pricing() returns trigger language plpgsql as $$
begin
  if old.billing_pricing is distinct from new.billing_pricing then
    raise exception 'approval_pricing_is_immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists generation_approval_pricing_immutable on generation_approvals;
create trigger generation_approval_pricing_immutable before update of billing_pricing on generation_approvals
  for each row execute function preserve_approval_pricing();
