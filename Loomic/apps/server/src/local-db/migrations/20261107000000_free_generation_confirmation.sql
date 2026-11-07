-- Free requests still require explicit consent when the caller forces confirmation.
alter table generation_approvals
  drop constraint if exists generation_approvals_estimated_credits_check;
alter table generation_approvals
  add constraint generation_approvals_estimated_credits_check check (estimated_credits >= 0);
