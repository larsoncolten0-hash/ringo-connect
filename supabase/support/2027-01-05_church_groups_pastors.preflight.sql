-- PREFLIGHT for 2027-01-05_church_groups_pastors.sql — READ-ONLY (one SELECT, no write). FOR OWNER REVIEW; run in the Supabase SQL Editor BEFORE applying the migration.
-- Every row must show ok = true. It proves everything the migration depends on exists and that none of the new objects exists yet (a clean first run). It reads the catalog only.

with
checks(label, expect, actual) as (
  select '01 church_groups, ministry_announcements and profiles exist', '3',
         (select count(*)::text from unnest(array['church_groups', 'ministry_announcements', 'profiles']) t where to_regclass('public.' || t) is not null)
  union all select '02 ministry_announcements.image_url exists (Phase 2 was applied)', '1',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'ministry_announcements' and column_name = 'image_url')
  union all select '03 the church helper functions exist', '4',
         (select count(*)::text from unnest(array['church_has_permission(uuid,text)', 'church_is_owner(uuid)', 'is_church_profile(uuid)', 'is_admin()']) f where to_regprocedure('public.' || f) is not null)
  union all select '04 the database roles anon, authenticated and service_role exist', '3', (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))
  union all select '05 none of the four new tables exists yet (0 expected)', '0',
         (select count(*)::text from unnest(array['church_public_groups', 'church_group_photos', 'church_pastors', 'church_about']) t where to_regclass('public.' || t) is not null)
  union all select '06 ministry_announcements.public_group_id does not exist yet (0 expected)', '0',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'ministry_announcements' and column_name = 'public_group_id')
  union all select '07 none of the new functions exists yet (0 expected)', '0',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_phase3_guard', 'church_group_photo_guard', 'ministry_announcement_group_guard'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
