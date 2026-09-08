-- Helstera Contact Sales inquiries
-- Stores enterprise sales inquiry submissions from the /contact-sales page.

CREATE TABLE IF NOT EXISTS public.contact_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Submitter details
  name text NOT NULL,
  email text NOT NULL,
  company text,
  phone text,
  team_size text,
  -- Inquiry body
  message text NOT NULL,
  plan text,
  source text DEFAULT 'pricing-page',
  -- 'new' | 'contacted' | 'qualified' | 'lost' | 'won'
  status text NOT NULL DEFAULT 'new',
  -- Internal notes from sales team
  notes text,
  -- Audit
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contact_inquiries_status_check
    CHECK (status IN ('new', 'contacted', 'qualified', 'lost', 'won'))
);

-- List view: newest first
CREATE INDEX IF NOT EXISTS contact_inquiries_created_at_idx
  ON public.contact_inquiries (created_at DESC);

-- Status filter (e.g., for "show only new inquiries")
CREATE INDEX IF NOT EXISTS contact_inquiries_status_idx
  ON public.contact_inquiries (status, created_at DESC)
  WHERE status = 'new';

-- Email lookup (for dedup / contact lookup)
CREATE INDEX IF NOT EXISTS contact_inquiries_email_idx
  ON public.contact_inquiries (email);

-- Enable RLS — service role bypasses these; anon key cannot read.
ALTER TABLE public.contact_inquiries ENABLE ROW LEVEL SECURITY;

-- Only service role (admin) can read; public can INSERT (rate limited at edge).
DROP POLICY IF EXISTS "Allow public insert on contact_inquiries" ON public.contact_inquiries;
CREATE POLICY "Allow public insert on contact_inquiries"
  ON public.contact_inquiries
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION public.touch_contact_inquiries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contact_inquiries_touch_updated_at ON public.contact_inquiries;
CREATE TRIGGER contact_inquiries_touch_updated_at
  BEFORE UPDATE ON public.contact_inquiries
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_contact_inquiries_updated_at();
