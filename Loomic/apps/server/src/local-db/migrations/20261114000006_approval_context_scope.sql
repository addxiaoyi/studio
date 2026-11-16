drop index if exists generation_approvals_one_pending_request_idx;
create unique index if not exists generation_approvals_pending_context_idx
  on generation_approvals(workspace_id,user_id,job_type,model,payload_fingerprint,(md5(context::text)))
  where status='pending';
