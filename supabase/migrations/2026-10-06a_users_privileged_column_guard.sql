-- ============================================================================
-- Ringo Connect - security: protect privileged columns on public.users
--
-- REQUIRES OWNER APPROVAL AND MANUAL APPLICATION. This file changes nothing until someone runs it. It is additive: ONE
-- new function and ONE new BEFORE INSERT / UPDATE trigger. No policy, grant, column, existing function or row is changed
-- or removed. Roll back with supabase/support/2026-10-06a_users_privileged_column_guard.rollback.sql.
--
-- THE PROBLEM
--   schema.sql defines   create policy "users update own row" on public.users for update using (auth.uid() = id or is_admin());
--   with no WITH CHECK and no column limit, and nothing else in the repository stops it (the only trigger on users,
--   protect_affiliate_fields, resets just affiliate_code / referred_by / affiliate_suspended). The Supabase REST API is
--   reachable by every signed-in browser with its own JWT, so an ordinary user could send
--       PATCH /rest/v1/users?id=eq.<my id>   {"role":"admin"}  /  {"plan_id":"<paid plan>"}  /  {"status":"active"}
--       /  {"can_approve_requests":true}
--   and become an admin, get a paid plan (Ringo AI, Business Toolkit, Team Management) for free, un-suspend themselves or
--   approve signup requests. The admin check (assertAdmin, is_admin()), plan gating, the AI gate and the toolkit lock all
--   trust these columns. (A file the code refers to, "fix-restrict-users-update.sql", was never committed, so the
--   protection cannot be assumed to exist in production.)
--
-- WHAT THE APPLICATION ACTUALLY NEEDS
--   Every write to public.users in the codebase goes through the service-role client (middleware activity ping, billing,
--   Stripe / Fapshi webhooks, admin routes, affiliate settings, onboarding, PWA install, demo creation, signup approval)
--   or runs inside a SECURITY DEFINER function / trigger owned by the table owner. No browser or session-scoped client
--   writes this table. So the policy is not needed by the app, but it is the hole.
--
-- THE FIX (smallest safe change; the policy is left exactly as it is)
--   A BEFORE INSERT / UPDATE trigger that, for any caller that is NOT service_role, the table owner or the internal
--   Supabase roles, refuses to change any column except a short ALLOWLIST of harmless self-service / telemetry columns.
--   An allowlist (not a blocklist) is deliberate: it also protects columns this repository does not know about
--   (payment_provider, billing_interval, stripe_*, plan_expires_at... exist in production but in no migration) and any
--   column added in future. Sending a column UNCHANGED is always allowed, so full-row style updates keep working.
--
--   normal user    -> may still touch onboarding_* / last_active_* / pwa_installed_at / updated_at (nothing else)
--   server / admin -> service_role (the admin client) and the table owner are unaffected
--
-- FAIL-CLOSED: the function has no exception handler. Any error inside it aborts the statement.
-- Run supabase/support/2026-10-06a_security_phase1.verify.sql afterwards.
-- ============================================================================

-- Preconditions: the guard trusts only roles the API cannot become. If an API role could become the table owner or
-- service_role, the guard would be bypassable, so refuse to install rather than install something that looks safe.
do $$
declare
  v_owner text;
  v_txt text;
begin
  select pg_get_userbyid(c.relowner) into v_owner from pg_class c where c.oid = 'public.users'::regclass;
  select string_agg(r.rolname::text, ', ') into v_txt from pg_roles r
   where r.rolname in ('anon', 'authenticated', 'authenticator')
     and (r.rolname::text = v_owner or pg_has_role(r.rolname::text, v_owner, 'MEMBER'));
  if v_txt is not null then
    raise exception 'guard precondition failed: API role(s) % are, or can become, the table owner %', v_txt, v_owner;
  end if;
  select string_agg(r.rolname::text, ', ') into v_txt from pg_roles r
   where r.rolname in ('anon', 'authenticated')
     and exists (select 1 from pg_roles x where x.rolname = 'service_role')
     and pg_has_role(r.rolname::text, 'service_role', 'MEMBER');
  if v_txt is not null then
    raise exception 'guard precondition failed: API role(s) % can become service_role', v_txt;
  end if;
end $$;

create or replace function public.protect_users_privileged_columns() returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner text;
  v_changed text;
  -- Columns a non-privileged caller may still change on its own row. Harmless telemetry / onboarding state only.
  c_self constant text[] := array['onboarding_completed_at', 'onboarding_dismissed_at', 'last_active_at', 'last_active_standalone', 'pwa_installed_at', 'updated_at'];
begin
  select pg_get_userbyid(c.relowner) into v_owner from pg_class c where c.oid = tg_relid;
  -- Trusted callers: the server (service_role), the table owner (migrations, SQL editor, SECURITY DEFINER functions
  -- owned by it, e.g. the signup trigger) and the two internal Supabase roles. The API roles can never become these
  -- (checked by the precondition above).
  if current_user::text in ('service_role', 'supabase_auth_admin', 'supabase_admin') or current_user::text = v_owner then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new row created by anyone else may only be an ordinary, unprivileged account.
    if new.role is distinct from 'creator' or coalesce(new.can_approve_requests, false) then
      raise exception 'users_privileged_column_protected' using errcode = '42501', detail = 'role, can_approve_requests';
    end if;
    return new;
  end if;

  select string_agg(n.key, ', ' order by n.key) into v_changed
    from jsonb_each(to_jsonb(new)) n
   where n.value is distinct from (to_jsonb(old) -> n.key)
     and n.key <> all (c_self);
  if v_changed is not null then
    raise exception 'users_privileged_column_protected' using errcode = '42501', detail = v_changed;
  end if;
  return new;
end;
$$;

-- A trigger function is never called directly; nobody needs EXECUTE on it.
revoke all on function public.protect_users_privileged_columns() from public, anon, authenticated, service_role;

-- Named so it fires BEFORE the older trg_attribute_referral / trg_protect_affiliate_fields (triggers fire alphabetically):
-- an attempt is refused loudly instead of being silently rewritten by a later trigger.
drop trigger if exists trg_a_protect_users_privileged on public.users;
create trigger trg_a_protect_users_privileged
  before insert or update on public.users
  for each row execute function public.protect_users_privileged_columns();

-- Postconditions: structure, then an adversarial self-test as an ordinary signed-in user. Any surprise RAISEs and rolls the
-- whole migration back. A blocked attempt changes nothing; if the guard were missing the attempt would succeed and the
-- RAISE would undo it, so the self-test leaves no trace on any live row.
do $$
declare
  v_uid uuid;
  v_blocked boolean;
  v_rows int;
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.users'::regclass and tgname = 'trg_a_protect_users_privileged'
                  and tgenabled = 'O' and not tgisinternal) then
    raise exception 'guard postcondition: trigger missing or disabled';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'protect_users_privileged_columns' and prosecdef) then
    raise exception 'guard postcondition: protect_users_privileged_columns must be SECURITY INVOKER';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.pronamespace = 'public'::regnamespace and p.proname = 'protect_users_privileged_columns' and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))) then
    raise exception 'guard postcondition: an API role can EXECUTE the guard function';
  end if;

  select id into v_uid from public.users where role = 'creator' and status = 'active' order by created_at limit 1;
  if v_uid is null then
    raise notice 'guard self-test skipped: no ordinary user row to test with (the structure checks above passed)';
    return;
  end if;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  set local role authenticated;
  v_blocked := false;
  begin
    update public.users set role = 'admin' where id = v_uid;
    get diagnostics v_rows = row_count;
  exception when sqlstate '42501' then
    v_blocked := true;
  end;
  reset role;
  if not v_blocked and v_rows > 0 then
    raise exception 'guard self-test FAILED: an ordinary user was able to change their own role';
  end if;
  if not v_blocked then
    raise notice 'guard self-test inconclusive (the update matched no row); structure checks passed';
  end if;
end $$;
