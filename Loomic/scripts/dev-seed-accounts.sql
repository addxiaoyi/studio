-- Seed four local PostgreSQL test accounts. Safe to re-run.
-- Password for every account: Helstera-Test-2026

do $$
declare
  pw_hash text := '8db030ca05f2286f09834ed7f9df586c:24a98eec40acdaeba9e75b1b50d2b114f37083e107892470122391ab3ddddfe6ddeb1ae1cd8c84f656a23d638cea21bef0cf36f7e7feffafa57357381268435e';
  account record;
  v_user_id uuid;
  v_workspace_id uuid;
begin
  for account in
    select * from (values
      ('free@test.helstera.com', 'Free Workspace', 50::numeric),
      ('starter@test.helstera.com', 'Starter Workspace', 1200::numeric),
      ('pro@test.helstera.com', 'Pro Workspace', 5000::numeric),
      ('ultra@test.helstera.com', 'Ultra Workspace', 15000::numeric)
    ) as seed(email, workspace_name, credits)
  loop
    insert into app_users(email, display_name, password_hash)
    values (account.email, account.workspace_name, pw_hash)
    on conflict (email) do update set
      display_name = excluded.display_name,
      password_hash = excluded.password_hash,
      updated_at = now()
    returning id into v_user_id;

    select id into v_workspace_id from workspaces where owner_user_id = v_user_id;
    if v_workspace_id is null then
      insert into workspaces(owner_user_id, name) values (v_user_id, account.workspace_name)
      returning id into v_workspace_id;
    else
      update workspaces set name = account.workspace_name, updated_at = now() where id = v_workspace_id;
    end if;

    insert into workspace_members(workspace_id, user_id, role)
    values (v_workspace_id, v_user_id, 'owner')
    on conflict (workspace_id, user_id) do update set role = 'owner';

    insert into credit_balances(workspace_id, balance)
    values (v_workspace_id, account.credits)
    on conflict (workspace_id) do update set balance = excluded.balance, updated_at = now();

    insert into workspace_settings(workspace_id, default_model, auto_approve_paid_generation)
    values (v_workspace_id, 'agnes-3.0-flash', false)
    on conflict (workspace_id) do nothing;
  end loop;
end
$$;
