alter table canvas_workflow_runs add column if not exists target_node_id text;
alter table canvas_workflow_proposals add column if not exists target_node_id text;
