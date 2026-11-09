create table if not exists canvas_workflow_versions (
  workflow_id uuid not null references canvas_workflows(id) on delete cascade,
  revision integer not null,
  graph jsonb not null,
  restored_from integer,
  created_at timestamptz not null default now(),
  primary key(workflow_id, revision)
);

insert into canvas_workflow_versions(workflow_id,revision,graph,created_at)
select id,revision,graph,updated_at from canvas_workflows on conflict do nothing;
insert into canvas_workflow_versions(workflow_id,revision,graph,created_at)
select distinct on (workflow_id,revision) workflow_id,revision,graph,created_at
from canvas_workflow_runs where target_node_id is null
order by workflow_id,revision,created_at desc on conflict do nothing;

create or replace function record_canvas_workflow_version() returns trigger language plpgsql as $$
begin
  insert into canvas_workflow_versions(workflow_id,revision,graph)
  values(new.id,new.revision,new.graph) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists canvas_workflow_version_saved on canvas_workflows;
create trigger canvas_workflow_version_saved after insert or update of graph,revision on canvas_workflows
for each row execute function record_canvas_workflow_version();
