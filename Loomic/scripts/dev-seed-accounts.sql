-- dev:seed-test-accounts — Create test accounts via raw SQL.
-- =============================================================
-- The supabase-mock doesn't implement /auth/v1/admin/users, so the
-- regular pnpm seed script fails. This SQL bypasses the admin API and
-- creates users directly in PostgreSQL — same data the real seed would
-- produce, just via a different transport.
--
-- Password (all four accounts): "Helstera-Test-2026"
-- Pre-computed bcryptjs hash (cost=10):
--   $2a$10$KIxqCqPqg.6YEh8yfVQi3eEH9XhC0YQUwL7vJLHXKCx1jBdOm1GC
--
-- Usage:
--   bash scripts/dev-local.sh   (runs automatically if pnpm seed fails)
--   # or:
--   docker exec -i docker-db_postgres-1 psql -U postgres -d helstera \
--     -f scripts/dev-seed-accounts.sql
-- =============================================================

-- Pre-computed bcryptjs hash for "Helstera-Test-2026" (cost 10)
-- (Generated with: node -e 'console.log(require("bcryptjs").hashSync("Helstera-Test-2026", 10))')
do $$
declare
  v_pw_hash text := '$2a$10$bBd4yikYKM3sWpxVOy3Uye1hVaLbKRhBcr1bzmn.SkrlV7mAx/9Xu';
  v_uid      uuid;
  v_ws_id    uuid;
  v_now      timestamptz := now();
  v_period_end timestamptz;
begin
  -- ── Loop over the 4 test accounts ──
  for i in 1..4 loop
    declare
      v_email   text;
      v_plan    text;
      v_credits bigint;
      v_name    text;
    begin
      if i = 1 then v_email := 'free@test.helstera.com';    v_plan := 'free';    v_credits := 50;     v_name := 'Free Workspace';    v_period_end := v_now + interval '30 days';
      elsif i = 2 then v_email := 'starter@test.helstera.com'; v_plan := 'starter'; v_credits := 1200;  v_name := 'Starter Workspace'; v_period_end := v_now + interval '30 days';
      elsif i = 3 then v_email := 'pro@test.helstera.com';     v_plan := 'pro';     v_credits := 5000;  v_name := 'Pro Workspace';     v_period_end := v_now + interval '30 days';
      else                v_email := 'ultra@test.helstera.com';   v_plan := 'ultra';   v_credits := 15000; v_name := 'Ultra Workspace';   v_period_end := v_now + interval '30 days';
      end if;

      -- 1. Create auth user (idempotent)
      select id into v_uid from auth.users where email = v_email;
      if v_uid is null then
        v_uid := gen_random_uuid();
        insert into auth.users (
          id, instance_id, email, encrypted_password, role,
          created_at, updated_at, email_confirmed_at,
          raw_user_meta_data, raw_app_meta_data
        ) values (
          v_uid, '00000000-0000-0000-0000-000000000000', v_email,
          v_pw_hash, 'authenticated', v_now, v_now, v_now,
          jsonb_build_object('display_name', v_name), '{}'::jsonb
        );
      end if;

      -- 2. Create or update personal workspace (idempotent: check first)
      select id into v_ws_id from public.workspaces
        where owner_user_id = v_uid and type = 'personal' limit 1;

      if v_ws_id is null then
        v_ws_id := gen_random_uuid();
        insert into public.workspaces (id, name, owner_user_id, type, created_at, updated_at)
        values (v_ws_id, v_name, v_uid, 'personal', v_now, v_now)
        returning id into v_ws_id;
      else
        update public.workspaces set name = v_name, updated_at = v_now
        where id = v_ws_id;
      end if;

      -- 3. Profile + workspace_members
      insert into public.profiles (id, display_name, email, created_at, updated_at)
      values (v_uid, v_name, split_part(v_email, '@', 1), v_now, v_now)
      on conflict (id) do nothing;

      insert into public.workspace_members (workspace_id, user_id, role, created_at)
      values (v_ws_id, v_uid, 'owner', v_now)
      on conflict (workspace_id, user_id) do nothing;

      -- 4. Subscription (upsert by workspace_id)
      insert into public.subscriptions (
        workspace_id, plan, billing_period, current_period_end, created_at, updated_at
      ) values (
        v_ws_id, v_plan::subscription_plan, 'monthly'::billing_period,
        v_period_end, v_now, v_now
      )
      on conflict (workspace_id) do update set
        plan = excluded.plan,
        billing_period = excluded.billing_period,
        current_period_end = excluded.current_period_end,
        updated_at = excluded.updated_at;

      -- 5. Credit balance (upsert, increment version)
      insert into public.credit_balances (workspace_id, balance, version, updated_at)
      values (v_ws_id, v_credits, 1, v_now)
      on conflict (workspace_id) do update set
        balance = v_credits,
        version = public.credit_balances.version + 1,
        updated_at = v_now;

      -- 6. Credit transaction (audit log)
      insert into public.credit_transactions (
        workspace_id, user_id, transaction_type, amount,
        description, balance_after, created_at
      ) values (
        v_ws_id, v_uid, 'admin_adjustment', v_credits,
        'Seed: initial ' || v_plan || ' credits', v_credits, v_now
      );

      raise notice 'Seeded % (% plan, % credits)', v_email, v_plan, v_credits;
    end;
  end loop;

  raise notice '';
  raise notice '✅ All 4 test accounts ready. Login password: Helstera-Test-2026';
end
$$;
