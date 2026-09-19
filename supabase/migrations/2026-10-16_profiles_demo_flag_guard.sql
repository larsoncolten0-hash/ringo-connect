-- ============================================================================
-- PROFILES DEMO-FLAG GUARD
--
-- Problem: profiles.is_demo and profiles.demo_expires_at are trusted by the server (payout / billing / invitation
-- blocks, the demo cleanup cron, the demo Partner test mode) but the existing grants and RLS let any signed-in
-- profile owner, and any Organization staff member with settings.manage, UPDATE them directly through the
-- Supabase REST API, in BOTH directions: real -> demo gains demo-only access; demo -> real escapes every demo
-- block; clearing or extending demo_expires_at escapes the cleanup cron.
--
-- Fix (additive only): ONE new function and ONE new BEFORE INSERT / UPDATE trigger on public.profiles. No existing
-- grant, policy, column, function or trigger is changed or removed.
--
-- TRUST RULE (final). The two columns may be set or changed only when current_user is
--   (a) service_role  (the server's createAdminClient: demo creation and demo seeding), or
--   (b) the OWNER of public.profiles, derived from the catalog at run time (SQL editor, migrations, and SECURITY
--       DEFINER functions owned by that role). No role name such as postgres or supabase_admin is hard-coded.
-- Every other role - anon, authenticated, or anything else - can neither change the columns on UPDATE nor
-- create a row with is_demo = true or a demo_expires_at on INSERT. Creating a profile with the defaults
-- (is_demo false, no expiry) stays allowed for everyone, so signup and normal profile creation are unaffected.
--
-- Why current_user, and why SECURITY INVOKER: PostgREST runs each request as the database role taken from the
-- verified JWT (SET LOCAL ROLE), and a client cannot change it, so current_user cannot be spoofed with request
-- headers or claims. A SECURITY DEFINER guard would always see the function owner as current_user and let every
-- caller through, so this function is deliberately SECURITY INVOKER.
--
-- Known limits (stated, not hidden): a superuser session that is not the table owner is not trusted by this rule
-- (it could still disable the trigger); a compromised service_role key, or any SECURITY DEFINER function owned by
-- the table owner that writes these columns from caller-supplied input, is outside what a trigger can prevent.
--
-- NOT in this migration: profiles.verified, users.plan_id, users.role, users.affiliate_code (separate reviews).
-- One transaction. Not re-runnable by design. Rollback: supabase/support/2026-10-16_profiles_demo_flag_guard.rollback.sql
-- ============================================================================
begin;

do $$
declare
  v_owner text;
  v_txt text;
begin
  if to_regclass('public.profiles') is null then
    raise exception 'guard precondition failed: public.profiles is missing';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
        and ((column_name = 'is_demo' and data_type = 'boolean')
          or (column_name = 'demo_expires_at' and data_type = 'timestamp with time zone'))) <> 2 then
    raise exception 'guard precondition failed: profiles.is_demo / demo_expires_at are missing or have unexpected types';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'trg_protect_demo_flags')
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'protect_demo_flags') then
    raise exception 'guard precondition failed: the guard already exists (not re-runnable by design)';
  end if;

  select pg_get_userbyid(relowner) into v_owner from pg_class where oid = 'public.profiles'::regclass;
  if v_owner is distinct from current_user::text then
    raise exception 'guard precondition failed: run as the table owner (% owns profiles, current user is %)', v_owner, current_user;
  end if;

  -- The trusted roles must not be reachable from an API role. anon / authenticated / authenticator must not be,
  -- or be able to become, the table owner; anon / authenticated must not be able to become service_role.
  -- (authenticator is deliberately not tested against service_role: PostgREST legitimately connects as
  -- authenticator and switches to the JWT's role.)
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

create function public.protect_demo_flags() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  v_owner text;
begin
  select pg_get_userbyid(c.relowner) into v_owner from pg_class c where c.oid = tg_relid;
  if current_user::text = 'service_role' or current_user::text = v_owner then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.is_demo is distinct from false or new.demo_expires_at is not null then
      raise exception 'demo_flag_protected' using errcode = '42501';
    end if;
  elsif new.is_demo is distinct from old.is_demo or new.demo_expires_at is distinct from old.demo_expires_at then
    raise exception 'demo_flag_protected' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_demo_flags() from public, anon, authenticated, service_role;

create trigger trg_protect_demo_flags
  before insert or update of is_demo, demo_expires_at on public.profiles
  for each row execute function public.protect_demo_flags();

-- Postconditions: structure, then an ADVERSARIAL self-test. Any surprise RAISEs and rolls the whole migration
-- back. A blocked attempt changes nothing; every control write is undone by a sentinel exception (a rolled-back
-- subtransaction), so the self-test leaves no trace on any live row.
do $$
declare
  v_pid uuid;
  v_uid uuid;
  v_demo_pid uuid;
  v_demo_uid uuid;
  v_blocked boolean;
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'trg_protect_demo_flags'
                  and tgenabled = 'O' and not tgisinternal) then
    raise exception 'guard postcondition: trigger missing or disabled';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'protect_demo_flags' and prosecdef) then
    raise exception 'guard postcondition: protect_demo_flags must be SECURITY INVOKER';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.pronamespace = 'public'::regnamespace and p.proname = 'protect_demo_flags' and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))) then
    raise exception 'guard postcondition: an API role can EXECUTE the guard function';
  end if;

  select id, user_id into v_pid, v_uid from public.profiles where is_demo is false and user_id is not null limit 1;
  if v_pid is not null then
    perform set_config('request.jwt.claim.sub', v_uid::text, true);

    -- an ordinary owner tries real -> demo
    v_blocked := false;
    begin
      set local role authenticated;
      update public.profiles set is_demo = true where id = v_pid;
      reset role;
    exception when sqlstate '42501' then
      reset role;
      if sqlerrm <> 'demo_flag_protected' then raise; end if;
      v_blocked := true;
    end;
    if not v_blocked then raise exception 'guard SELF-TEST FAILED: an ordinary owner could set is_demo'; end if;

    -- an ordinary owner tries to set a demo expiry
    v_blocked := false;
    begin
      set local role authenticated;
      update public.profiles set demo_expires_at = now() + interval '3650 days' where id = v_pid;
      reset role;
    exception when sqlstate '42501' then
      reset role;
      if sqlerrm <> 'demo_flag_protected' then raise; end if;
      v_blocked := true;
    end;
    if not v_blocked then raise exception 'guard SELF-TEST FAILED: an ordinary owner could set demo_expires_at'; end if;

    -- the same owner may still perform an ordinary, unchanged write (normal editing is unaffected)
    begin
      set local role authenticated;
      update public.profiles set is_demo = is_demo where id = v_pid;
      raise exception 'selftest_ok';
    exception when others then
      reset role;
      if sqlerrm <> 'selftest_ok' then
        raise exception 'guard SELF-TEST FAILED: an unchanged write by the owner was refused: %', sqlerrm;
      end if;
    end;

    -- the trusted server role may write the flags (no value change here; undone the same way)
    begin
      set local role service_role;
      update public.profiles set is_demo = is_demo, demo_expires_at = demo_expires_at where id = v_pid;
      raise exception 'selftest_ok';
    exception when others then
      reset role;
      if sqlerrm <> 'selftest_ok' then
        raise exception 'guard SELF-TEST FAILED: service_role was refused: %', sqlerrm;
      end if;
    end;
  end if;

  select id, user_id into v_demo_pid, v_demo_uid from public.profiles where is_demo is true and user_id is not null limit 1;
  if v_demo_pid is not null then
    perform set_config('request.jwt.claim.sub', v_demo_uid::text, true);
    v_blocked := false;
    begin
      set local role authenticated;
      update public.profiles set is_demo = false where id = v_demo_pid;
      reset role;
    exception when sqlstate '42501' then
      reset role;
      if sqlerrm <> 'demo_flag_protected' then raise; end if;
      v_blocked := true;
    end;
    if not v_blocked then raise exception 'guard SELF-TEST FAILED: a demo user could clear is_demo'; end if;

    v_blocked := false;
    begin
      set local role authenticated;
      update public.profiles set demo_expires_at = null where id = v_demo_pid;
      reset role;
    exception when sqlstate '42501' then
      reset role;
      if sqlerrm <> 'demo_flag_protected' then raise; end if;
      v_blocked := true;
    end;
    if not v_blocked then raise exception 'guard SELF-TEST FAILED: a demo user could clear demo_expires_at'; end if;
  end if;
end $$;

commit;
