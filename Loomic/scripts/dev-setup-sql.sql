-- dev:setup — Local Supabase Mock Schema Init
-- ===========================================
-- Runs BEFORE supabase/migrations/*.sql to set up the `auth` schema,
-- auth.uid() function, and storage schema that the migrations expect
-- (mirroring what a real Supabase instance provides out-of-the-box).
--
-- Usage:
--   bash scripts/dev-setup-sql.sh
--   # or manually via psql:
--   psql -U postgres -d helstera -f scripts/dev-setup-sql.sql

-- ── pgcrypto extension (for gen_random_uuid, crypt) ──
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── auth schema (the "public-facing" auth API) ──
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO public;

CREATE TABLE IF NOT EXISTS auth.users (
  instance_id uuid,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aud varchar(255),
  role varchar(255),
  email varchar(255) UNIQUE,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token varchar(255),
  recovery_sent_at timestamptz,
  email_change_token_new varchar(255),
  email_change varchar(255),
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  is_super_admin boolean,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  phone varchar(15),
  phone_confirmed_at timestamptz,
  phone_change varchar(15) DEFAULT '',
  phone_change_token varchar(255) DEFAULT '',
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
  email_change_token_current varchar(255) DEFAULT '',
  email_change_confirm_status smallint DEFAULT 0 CHECK (email_change_confirm_status >= 0 AND email_change_confirm_status <= 2),
  banned_until timestamptz,
  reauthentication_token varchar(255) DEFAULT '',
  reauthentication_sent_at timestamptz,
  is_sso_user boolean DEFAULT false,
  deleted_at timestamptz
);

-- auth.uid() — returns the current user id (set by the API server)
-- The real Supabase injects a "request.jwt.claims" GUC per request.
-- In dev/mock we use a GUC named `app.current_user_id` and read from it.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- The mock API server is expected to set this GUC per request.
-- (For dev, the supabase-mock Fastify server should issue `SELECT set_config('app.current_user_id', ...)` at the top of each authenticated request.)

-- ── auth role: create role authenticated/service_role if missing ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END
$$;

-- ── storage schema (Supabase Storage — stub for local dev) ──
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO authenticated, service_role, anon;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ── realtime schema (stub) ──
CREATE SCHEMA IF NOT EXISTS realtime;
GRANT USAGE ON SCHEMA realtime TO authenticated, service_role, anon;

-- ── extensions schema (where Supabase puts extensions) ──
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO authenticated, service_role, anon;
ALTER DATABASE helstera SET search_path = public, extensions, auth, storage, realtime;

-- ── success marker ──
DO $$
BEGIN
  RAISE NOTICE '✅ Helstera local schema initialized successfully';
  RAISE NOTICE '   Run supabase migrations next: scripts/dev-setup-migrations.sh';
END
$$;

-- =====================================================================
-- LOCAL DEV ONLY: Disable RLS so the supabase-mock (which doesn't set
-- the auth.uid() GUC per request) can run without auth-context plumbing.
-- DO NOT run this on real Supabase. The mock server should eventually
-- wrap each request in `SELECT set_config('app.current_user_id', ...)`
-- and re-enable these. See scripts/dev-setup-sql.sql comment block.
-- =====================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname IN (
        'profiles', 'workspaces', 'workspace_members', 'projects',
        'canvases', 'asset_objects', 'credit_balances', 'subscriptions',
        'credit_transactions', 'brand_kits', 'brand_kit_assets',
        'home_example_library', 'home_discovery_library',
        'video_generation_jobs', 'background_jobs', 'workspace_skills',
        'yeepay_orders', 'contact_inquiries', 'credit_topups',
        'ecom_jobs', 'marketplace_skills'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    RAISE NOTICE 'RLS disabled on public.% for dev', t;
  END LOOP;
END
$$;
