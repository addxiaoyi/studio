alter table canvas_workflow_runs add column if not exists budget_credits numeric(14,4) not null default 0
  check (budget_credits >= 0 and budget_credits <= 100000);

create table if not exists canvas_workflow_budget_reservations (
  approval_id uuid primary key references generation_approvals(id),
  run_id uuid not null references canvas_workflow_runs(id) on delete cascade,
  credits numeric(14,4) not null check (credits >= 0),
  created_at timestamptz not null default now()
);
create index if not exists workflow_budget_run_idx on canvas_workflow_budget_reservations(run_id);

-- Preserve already-approved historical work. Only new confirmations consume the remaining cap.
insert into canvas_workflow_budget_reservations(approval_id,run_id,credits)
select a.id,r.id,a.estimated_credits from generation_approvals a
join canvas_workflow_runs r on r.goal_id::text=a.context->>'workflowGoalId'
where a.status='approved' and a.estimated_credits>=0 on conflict do nothing;
update canvas_workflow_runs r set budget_credits=least(100000,greatest(budget_credits,
  coalesce((select sum(b.credits) from canvas_workflow_budget_reservations b where b.run_id=r.id),0)));

create or replace function reserve_workflow_generation_budget() returns trigger language plpgsql as $$
declare budget_run_id uuid; budget numeric; used numeric; reserved numeric;
begin
  if new.status<>'approved' or coalesce(new.context->>'workflowGoalId','')='' then return new; end if;
  select r.id,r.budget_credits into budget_run_id,budget from canvas_workflow_runs r
    join agent_goals g on g.id=r.goal_id
    where r.goal_id::text=new.context->>'workflowGoalId' and g.workspace_id=new.workspace_id and g.created_by=new.user_id
    for update of r;
  if budget_run_id is null then raise exception using errcode='P0001',message='workflow_budget_missing'; end if;
  select credits into reserved from canvas_workflow_budget_reservations where approval_id=new.id;
  if reserved is not null then
    if reserved<>new.estimated_credits then raise exception using errcode='P0001',message='workflow_budget_quote_changed'; end if;
    return new;
  end if;
  select coalesce(sum(credits),0) into used from canvas_workflow_budget_reservations b where b.run_id=budget_run_id;
  if new.estimated_credits<0 or used+new.estimated_credits>budget then
    raise exception using errcode='P0001',message='workflow_budget_exceeded',detail=format('limit=%s reserved=%s requested=%s',budget,used,new.estimated_credits);
  end if;
  insert into canvas_workflow_budget_reservations(approval_id,run_id,credits) values(new.id,budget_run_id,new.estimated_credits);
  return new;
end $$;
drop trigger if exists workflow_generation_budget on generation_approvals;
create trigger workflow_generation_budget after insert or update of status,estimated_credits,context
  on generation_approvals for each row execute function reserve_workflow_generation_budget();
