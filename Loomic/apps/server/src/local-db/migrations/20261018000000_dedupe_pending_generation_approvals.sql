with ranked_pending as (
  select id,
         row_number() over (
           partition by workspace_id, user_id, job_type, model, payload_fingerprint,
             coalesce(context->>'canvasId', ''), coalesce(context->>'sessionId', '')
           order by created_at desc, id desc
         ) as duplicate_rank
  from generation_approvals
  where status = 'pending' and expires_at > now()
)
update generation_approvals approval
set status = 'expired'
from ranked_pending ranked
where approval.id = ranked.id and ranked.duplicate_rank > 1;

update generation_approvals
set status = 'expired'
where status = 'pending' and expires_at <= now();

create unique index if not exists generation_approvals_one_pending_request_idx
  on generation_approvals (
    workspace_id,
    user_id,
    job_type,
    model,
    payload_fingerprint,
    (coalesce(context->>'canvasId', '')),
    (coalesce(context->>'sessionId', ''))
  )
  where status = 'pending';
