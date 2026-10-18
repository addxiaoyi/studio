-- Keep paid generation retries on one durable job and one credit transaction.
ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS auto_approve_paid_generation boolean NOT NULL DEFAULT false;

ALTER TABLE public.background_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS background_jobs_created_by_idempotency_idx
  ON public.background_jobs(created_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
