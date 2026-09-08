-- Supabase 兼容 Mock 层 - 在本地 PostgreSQL 上模拟 Supabase 必需的核心组件
-- Helstera migrations 大量依赖 Supabase Auth、Storage 等专有 schema/role
-- 这里创建最小化的 stub，让 migrations 能成功执行

-- ═══════════════════════════════════════════════════════════════
-- 1. 创建必需的 PostgreSQL roles（Supabase 角色）
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
  -- 注意：如果 role 已存在会报错，使用 EXCEPTION 处理
  BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN END;
  BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN END;
  BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN END;
  BEGIN CREATE ROLE supabase_auth_admin NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN END;
  BEGIN CREATE ROLE supabase_storage_admin NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN END;
  BEGIN CREATE ROLE authenticator LOGIN PASSWORD 'authenticator' NOINHERIT; EXCEPTION WHEN duplicate_object THEN END;
END $$;

GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role TO authenticator;
GRANT supabase_auth_admin TO authenticator;
GRANT supabase_storage_admin TO authenticator;

-- ═══════════════════════════════════════════════════════════════
-- 2. 创建 auth schema（Supabase Auth 的 stub）
-- ═══════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- auth.users 表（最小化：只包含 Helstera 用到的列）
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  instance_id uuid,
  aud text,
  role text DEFAULT 'authenticated'
);

GRANT ALL ON auth.users TO anon, authenticated, service_role;

-- auth.identities（Supabase 2023+ 必需）
CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_data jsonb,
  provider text,
  provider_id text,
  created_at timestamptz DEFAULT now()
);

-- auth.sessions
CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  not_after timestamptz
);

-- auth.refresh_tokens
CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  token text,
  created_at timestamptz DEFAULT now(),
  revoked boolean DEFAULT false
);

-- auth.uid() 函数 - 模拟从 JWT 提取当前用户 ID
-- 真实场景中：Supabase 通过 request.jwt.claims 提取
-- 这里我们用 current_setting('request.jwt.claims', true) 模拟
-- 在客户端连接时通过 SET request.jwt.claims = '{"sub":"uuid"}' 注入
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(
      NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid,
      NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
      NULL
    )::uuid;
$$;

-- auth.jwt() 函数
CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(
      NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    );
$$;

-- auth.role() 函数
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(
      NULLIF(current_setting('request.jwt.claim.role', true), ''),
      NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      'anon'
    );
$$;

-- auth.email() 函数
CREATE OR REPLACE FUNCTION auth.email()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(
      NULLIF(current_setting('request.jwt.claim.email', true), ''),
      NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'
    );
$$;

-- ═══════════════════════════════════════════════════════════════
-- 3. 创建 storage schema（Supabase Storage 的 stub）
-- ═══════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_storage_objects_bucket_name ON storage.objects(bucket_id, name);

GRANT ALL ON storage.buckets TO anon, authenticated, service_role;
GRANT ALL ON storage.objects TO anon, authenticated, service_role;

-- storage.foldername() 函数
CREATE OR REPLACE FUNCTION storage.foldername(p_name text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT string_to_array(regexp_replace(p_name, '/[^/]*$', ''), '/');
$$;

-- ═══════════════════════════════════════════════════════════════
-- 4. extensions schema
-- ═══════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

-- 把 gen_random_uuid 暴露在 extensions schema
CREATE OR REPLACE FUNCTION extensions.gen_random_uuid()
RETURNS uuid
LANGUAGE sql
VOLATILE
AS $$
  SELECT gen_random_uuid();
$$;
GRANT EXECUTE ON FUNCTION extensions.gen_random_uuid() TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════
-- 5. graphql_public schema（Supabase 默认包含）
-- ═══════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS graphql_public;
GRANT USAGE ON SCHEMA graphql_public TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════
-- 6. realtime schema
-- ═══════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS realtime;
GRANT USAGE ON SCHEMA realtime TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════
-- 7. pgcrypto 扩展（已检查可用）
-- ═══════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- 将 gen_random_uuid 暴露在 extensions
ALTER FUNCTION gen_random_uuid() SET SCHEMA extensions;

-- 兼容性提示：让 service_role 角色能 BYPASS RLS
ALTER ROLE service_role BYPASSRLS;
ALTER ROLE supabase_auth_admin BYPASSRLS;
ALTER ROLE supabase_storage_admin BYPASSRLS;
