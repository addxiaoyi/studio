alter table agent_runs add column if not exists run_owner uuid;
alter table agent_runs add column if not exists run_lease_until timestamptz;

-- Legacy runs need explicit recovery; age alone cannot prove their owner has stopped.
create index if not exists agent_runs_expired_owner_idx on agent_runs(run_lease_until)
where run_owner is not null and status in ('accepted','running');
