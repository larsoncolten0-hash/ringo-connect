-- ============================================================================
-- Ringo Connect - security: protect privileged columns on public.profiles
--
-- REQUIRES OWNER APPROVAL AND MANUAL APPLICATION. Additive: ONE new function and ONE new BEFORE INSERT / UPDATE trigger.
-- No policy, grant, column, existing function / trigger or row is changed. Roll back with
-- supabase/support/2026-10-06b_profiles_privileged_column_guard.rollback.sql. Companion to
-- 2026-10-16_profiles_demo_flag_guard.sql (which guards is_demo / demo_expires_at and is left untouched).
--
-- THE PROBLEM (verified in the repository)
--   1. "profiles update by owner or admin" lets an owner update ANY column of their own profile from the browser, and
--      "profiles insert by owner" lets them insert one. So an owner can set  verified = true  (the public blue badge) and
--      skip the whole verification-request workflow. Only admin routes (service role) are meant to write it.
--   2. "profiles staff settings update" (2026-10-01_team_management.sql) lets ANY staff member holding settings.manage
--      update ANY column of the business profile, and it is keyed on the PROFILE id, not on profiles.user_id. A staff member
--      could therefore run  update profiles set user_id = <their own id>  and take over the business (the original owner
--      loses access), or set verified.
--
-- WHAT IS PROTECTED (and why only these)
--   verified   admin-granted trust badge; written only by service-role admin routes
--   user_id    ownership; written only on creation (service role) and by cascade
--   id         primary key
--   Everything else stays editable: it is the normal profile editor (name, bio, theme, published, categories, ordering_enabled,
--   bookings_enabled, community_enabled, ... - ordering_enabled and the other toggles are legitimate owner settings that the
--   dashboard writes from the browser).
--
-- Same trust model as the users guard: service_role, the table owner (migrations, SECURITY DEFINER functions such as the
-- signup path) and the internal Supabase roles are unaffected; the API roles can never become them (precondition below).
-- Sending a protected column UNCHANGED is allowed, so full-row saves keep working. FAIL-CLOSED: no exception handler.
-- Run supabase/support/2026-10-06a_security_phase1.verify.sql afterwards.
-- ============================================================================

do $$
declare
  v_owner text;
  v_txt text;
begin
  select pg_get_userbyid(c.relowner) into v_owner from pg_class c where c.oid = 'public.profiles'::regclass;
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

create or replace function public.protect_profile_privileged_columns() returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner text;
begin
  select pg_get_userbyid(c.relowner) into v_owner from pg_class c where c.oid = tg_relid;
  if current_user::text in ('service_role', 'supabase_auth_admin', 'supabase_admin') or current_user::text = v_owner then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.verified is distinct from false then
      raise exception 'profile_privileged_column_protected' using errcode = '42501', detail = 'verified';
    end if;
    return new;
  end if;

  if new.verified is distinct from old.verified or new.user_id is distinct from old.user_id or new.id is distinct from old.id then
    raise exception 'profile_privileged_column_protected' using errcode = '42501',
      detail = concat_ws(', ',
        case when new.verified is distinct from old.verified then 'verified' end,
        case when new.user_id is distinct from old.user_id then 'user_id' end,
        case when new.id is distinct from old.id then 'id' end);
  end if;
  return new;
end;
$$;

revoke all on function public.protect_profile_privileged_columns() from public, anon, authenticated, service_role;

-- Fires before trg_protect_demo_flags (alphabetical), which stays in place.
drop trigger if exists trg_a_protect_profile_privileged on public.profiles;
create trigger trg_a_protect_profile_privileged
  before insert or update on public.profiles
  for each row execute function public.protect_profile_privileged_columns();

do $$
declare
  v_pid uuid;
  v_uid uuid;
  v_blocked boolean;
  v_rows int;
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'trg_a_protect_profile_privileged'
                  and tgenabled = 'O' and not tgisinternal) then
    raise exception 'guard postcondition: trigger missing or disabled';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'protect_profile_privileged_columns' and prosecdef) then
    raise exception 'guard postcondition: protect_profile_privileged_columns must be SECURITY INVOKER';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.pronamespace = 'public'::regnamespace and p.proname = 'protect_profile_privileged_columns' and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))) then
    raise exception 'guard postcondition: an API role can EXECUTE the guard function';
  end if;

  select id, user_id into v_pid, v_uid from public.profiles where verified is false and user_id is not null order by created_at limit 1;
  if v_pid is null then
    raise notice 'guard self-test skipped: no unverified profile to test with (the structure checks above passed)';
    return;
  end if;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  set local role authenticated;
  v_blocked := false;
  begin
    update public.profiles set verified = true where id = v_pid;
    get diagnostics v_rows = row_count;
  exception when sqlstate '42501' then
    v_blocked := true;
  end;
  reset role;
  if not v_blocked and v_rows > 0 then
    raise exception 'guard self-test FAILED: a profile owner was able to set verified on their own profile';
  end if;
  if not v_blocked then
    raise notice 'guard self-test inconclusive (the update matched no row); structure checks passed';
  end if;
end $$;
