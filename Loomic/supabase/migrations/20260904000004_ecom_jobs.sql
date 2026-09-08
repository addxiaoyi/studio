-- ecom_jobs table — stores e-commerce image generation jobs
-- One row per batch; outputs are stored as JSON in the same row.
CREATE TABLE IF NOT EXISTS public.ecom_jobs (
  -- UUID primary key, auto-generated
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Workspace that owns the job
  workspace_id text NOT NULL,
  -- User that triggered the job
  user_id text NOT NULL,
  -- Product name + optional description
  product_name text NOT NULL,
  product_description text,
  -- Scene IDs requested (1-25)
  scene_ids text[] NOT NULL,
  -- Output aspect ratio
  ratio text NOT NULL DEFAULT '1:1',
  -- Optional reference image for product consistency
  reference_image_url text,
  -- Generated style lock (for multi-image consistency)
  style_lock jsonb NOT NULL,
  -- Conversion driver diagnosis
  conversion_driver text NOT NULL,
  -- Assembled prompts, one per scene
  prompts jsonb NOT NULL,
  -- Job status
  status text NOT NULL DEFAULT 'pending',
  -- Per-scene output URLs / errors (updated as scenes complete)
  outputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Progress percentage (0-100)
  progress integer NOT NULL DEFAULT 0,
  -- Credits charged for this batch
  credits_charged integer NOT NULL DEFAULT 0,
  -- Error message if status = failed
  error_message text,
  -- Timestamps (ms since epoch, matching other tables)
  created_at bigint NOT NULL,
  completed_at bigint,

  CONSTRAINT ecom_jobs_status_check
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  CONSTRAINT ecom_jobs_driver_check
    CHECK (conversion_driver IN ('visual', 'pain-point', 'emotional'))
);

-- Workspace + recency lookup
CREATE INDEX IF NOT EXISTS ecom_jobs_workspace_idx
  ON public.ecom_jobs (workspace_id, created_at DESC);

-- User lookup (for "my recent jobs")
CREATE INDEX IF NOT EXISTS ecom_jobs_user_idx
  ON public.ecom_jobs (user_id, created_at DESC);

-- Auto-update trigger: when status moves to succeeded/failed, set completed_at
-- NOTE: Supabase handles this via the app layer for now (no trigger needed,
-- but kept as a comment for reference).
