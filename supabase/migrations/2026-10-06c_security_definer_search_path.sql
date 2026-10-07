-- ============================================================================
-- Ringo Connect - security: pin search_path on the SECURITY DEFINER functions that still have none, and make
-- protect_affiliate_fields fail CLOSED.
--
-- REQUIRES OWNER APPROVAL AND MANUAL APPLICATION. No table, policy, grant, owner, body or row is changed. The only changes are:
--   (a) ALTER FUNCTION ... SET search_path on 16 existing functions (their bodies are untouched), and
--   (b) one CREATE OR REPLACE of protect_affiliate_fields (same name, signature, owner, grants and trigger) without its
--       catch-all exception handler.
-- Roll back with supabase/support/2026-10-06c_security_definer_search_path.rollback.sql.
--
-- APPLICATION ORDER (important): this file is dated 2026-10-06, EARLIER than 24 existing migrations (2026-10-07 .. 2026-12-16). Production is
-- applied by hand, so run it after the others already applied there. On a CLEAN rebuild that replays migrations in filename order it would run
-- BEFORE some functions exist (request_commerce_payout, for one, is created on 2026-11-05): the loop below simply skips what is not there and
-- prints a notice, and the verify script (2026-10-06a_security_phase1.verify.sql, group C1) will then list anything left unpinned, so re-run this
-- file once after a full replay.
--
-- WHY
--   A SECURITY DEFINER function runs with its OWNER's privileges. Without a pinned search_path, an unqualified table or
--   function name inside it is resolved through the CALLER's search_path - and pg_temp is searched first for relations - so a
--   caller who can run SQL could shadow a table (e.g. organization_members) with an object of their own and have the function
--   trust it. The PostgREST API cannot run arbitrary SQL, so this is defense in depth, not an open hole, but it is the standard
--   hardening and it is cheap: functions that have it already (130 of 147) are the repository's own convention.
--
-- WHAT EACH PATH IS
--   pg_catalog, public, pg_temp                 - bodies reference only built-ins and public objects. pg_temp is LAST, so a temp
--                                                 object can never shadow a real one.
--   pg_catalog, public, extensions, pg_temp     - bodies call gen_random_bytes() (pgcrypto). On Supabase pgcrypto lives in the
--                                                 `extensions` schema; pinning to `public` alone would make every INSERT into
--                                                 tickets / scanner sessions / restaurant tables / users fail. A schema that does
--                                                 not exist in a path is simply ignored, so this is also correct where pgcrypto
--                                                 is in public.
--   Every body was read first: auth.uid() is always schema-qualified, nothing else outside pg_catalog / public / extensions is
--   referenced, and SECURITY DEFINER functions are never inlined into callers, so pinning the path cannot change a query plan.
--
-- protect_affiliate_fields (the special case)
--   Its latest definition (2026-09-09_affiliate_trigger_hardening.sql) wrapped the whole body in
--   `exception when others then null`. That was added in a signup incident so no affiliate trigger could ever abort account
--   creation (the real culprit was set_affiliate_code() calling a missing pgcrypto; that function keeps its own fallback and is
--   untouched). For a SECURITY GUARD the same pattern is wrong: if is_admin() or auth.uid() ever failed, the update went through
--   with affiliate_code / referred_by / affiliate_suspended UNPROTECTED (fail-open). The body only runs
--   `auth.uid() is not null and not is_admin()`: GoTrue signup, the admin API and the service-role key have auth.uid() = null and
--   short-circuit BEFORE is_admin() is evaluated, so removing the handler cannot block signup, payments or admin flows; it only
--   means a failure now refuses the user's own update instead of letting it bypass the guard. Behaviour otherwise identical:
--   a signed-in non-admin's attempt to change those three columns is silently reverted (the new users guard
--   2026-10-06a_users_privileged_column_guard.sql additionally refuses it loudly).
-- ============================================================================

create or replace function public.protect_affiliate_fields() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.affiliate_code := old.affiliate_code;
    new.referred_by := old.referred_by;
    new.affiliate_suspended := old.affiliate_suspended;
  end if;
  return new;
end;
$$;

do $$
declare
  r record;
  v_std constant text := 'pg_catalog, public, pg_temp';
  v_ext constant text := 'pg_catalog, public, extensions, pg_temp';
  v_missing text := '';
begin
  for r in
    select * from (values
      ('public.attribute_referral()',                                      v_std),
      ('public.checkin_ticket(uuid, text, text)',                          v_std),
      ('public.handle_payment_transaction_commission()',                   v_std),
      ('public.has_org_permission(uuid, text)',                            v_std),
      ('public.is_admin()',                                                v_std),
      ('public.is_org_member(uuid)',                                       v_std),
      ('public.org_team_enabled(uuid)',                                    v_std),
      ('public.release_event_ticket_type(uuid, integer)',                  v_std),
      ('public.request_affiliate_payout(text)',                            v_std),
      ('public.request_commerce_payout()',                                 v_std),
      ('public.request_music_payout(text)',                                v_std),
      ('public.reserve_event_ticket_type(uuid, integer)',                  v_std),
      ('public.set_affiliate_code()',                                      v_ext),
      ('public.set_digital_ticket_code()',                                 v_ext),
      ('public.set_scanner_session_token()',                               v_ext),
      ('public.set_table_public_code()',                                   v_ext)
    ) as t(sig, path)
  loop
    if to_regprocedure(r.sig) is null then
      v_missing := v_missing || ' ' || r.sig;
    else
      execute format('alter function %s set search_path = %s', r.sig, r.path);
    end if;
  end loop;
  if v_missing <> '' then
    raise notice 'search_path hardening skipped (function not present in this database):%', v_missing;
  end if;
end $$;

-- Postconditions: every function that exists now has a pinned path ending in pg_temp, protect_affiliate_fields has no
-- exception handler left, and nothing about its ownership / grants changed.
do $$
declare
  v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('attribute_referral','checkin_ticket','handle_payment_transaction_commission','has_org_permission','is_admin',
                       'is_org_member','org_team_enabled','protect_affiliate_fields','release_event_ticket_type','request_affiliate_payout',
                       'request_commerce_payout','request_music_payout','reserve_event_ticket_type','set_affiliate_code',
                       'set_digital_ticket_code','set_scanner_session_token','set_table_public_code')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%' and c like '%pg_temp');
  if v_bad is not null then
    raise exception 'postcondition failed: no pinned search_path on: %', v_bad;
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'protect_affiliate_fields'
              and pg_get_functiondef(oid) ilike '%exception when others%') then
    raise exception 'postcondition failed: protect_affiliate_fields still swallows exceptions';
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%');
  if v_bad is not null then
    raise notice 'REMAINING SECURITY DEFINER functions without a pinned search_path (not in this migration''s scope): %', v_bad;
  end if;
end $$;
