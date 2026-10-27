-- PREFLIGHT for 2027-01-06_church_membership_requests.sql — READ-ONLY (one SELECT, no write). FOR OWNER REVIEW; run in the Supabase SQL Editor BEFORE applying the migration.
-- Every row must show ok = true. It proves everything the migration depends on exists and that none of the new objects exists yet (a clean first run). It reads the catalog only: no member is read.

with
checks(label, expect, actual) as (
  select '01 church_members, ringo_customers, customer_connections and profiles exist', '4',
         (select count(*)::text from unnest(array['church_members', 'ringo_customers', 'customer_connections', 'profiles']) t where to_regclass('public.' || t) is not null)
  union all select '02 the church helper functions exist', '4',
         (select count(*)::text from unnest(array['church_has_permission(uuid,text)', 'is_church_profile(uuid)', 'church_is_owner(uuid)', 'is_admin()']) f where to_regprocedure('public.' || f) is not null)
  union all select '03 ringo_customers has name, email, phone and preferred_language', '4',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'ringo_customers' and column_name in ('name', 'email', 'phone', 'preferred_language'))
  union all select '04 customer_connections has customer_id, profile_id and status', '3',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'customer_connections' and column_name in ('customer_id', 'profile_id', 'status'))
  union all select '05 the database roles anon, authenticated and service_role exist', '3', (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))
  union all select '06 the decision columns do not exist yet (0 expected)', '0',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'church_members' and column_name in ('decided_at', 'decided_by'))
  union all select '07 none of the new functions exists yet (0 expected)', '0',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_member_decision_guard', 'church_request_membership'))
  union all select '08 the new trigger and policy do not exist yet (0 expected)', '0',
         ((select count(*) from pg_trigger where not tgisinternal and tgname = 'church_members_decision_guard_trg') + (select count(*) from pg_policy where polname = 'church_members_update_requests'))::text
  union all select '09 the Phase 2A update policy of the roster is in place (the new policy sits beside it)', '1',
         (select count(*)::text from pg_policy where polname = 'church_members_update' and polrelid = 'public.church_members'::regclass)
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
