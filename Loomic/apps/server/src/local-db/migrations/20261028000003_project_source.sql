-- Track how each project was created, so projects auto-created by the desktop
-- home entry point (source = 'home') are distinguishable from explicit
-- "new project" creations (source = 'manual') and future imports.
--
-- `add column if not exists` keeps this migration idempotent, and the
-- `default 'manual'` backfills every pre-existing row in the same statement,
-- so historical projects keep their current meaning (all of them were created
-- through an explicit action).
alter table projects add column if not exists source text not null default 'manual';

-- Postgres names an inline `check` constraint `<table>_<column>_check`, so new
-- databases created from schema.sql already have it; guard on the name to keep
-- this statement idempotent for older databases too.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_source_check'
      and conrelid = 'projects'::regclass
  ) then
    alter table projects
      add constraint projects_source_check
      check (source in ('home', 'manual', 'import'));
  end if;
end
$$;
