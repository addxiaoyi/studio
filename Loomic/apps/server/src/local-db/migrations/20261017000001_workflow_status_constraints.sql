-- Keep upgrades from older installations from rejecting the running state.
do $$
begin
  if to_regclass('agent_workflow_plans') is not null then
    alter table agent_workflow_plans drop constraint if exists agent_workflow_plans_status_check;
    alter table agent_workflow_plans
      add constraint agent_workflow_plans_status_check
      check (status in ('planned', 'running', 'paused', 'completed', 'failed'));
  end if;

  if to_regclass('feed_automation_runs') is not null then
    alter table feed_automation_runs drop constraint if exists feed_automation_runs_status_check;
    alter table feed_automation_runs
      add constraint feed_automation_runs_status_check
      check (status in ('queued', 'running', 'draft_ready', 'failed'));
  end if;
end $$;
