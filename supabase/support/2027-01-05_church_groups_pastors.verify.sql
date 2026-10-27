-- VERIFY for 2027-01-05_church_groups_pastors.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog only: no group, photo, pastor or announcement is created, read or changed.

with
checks(label, expect, actual) as (
  select '01 the four tables exist', '4', (select count(*)::text from unnest(array['church_public_groups', 'church_group_photos', 'church_pastors', 'church_about']) t where to_regclass('public.' || t) is not null)
  union all select '02 row-level security is on for all four', '4',
         (select count(*)::text from pg_class c where c.oid in ('public.church_public_groups'::regclass, 'public.church_group_photos'::regclass, 'public.church_pastors'::regclass, 'public.church_about'::regclass) and c.relrowsecurity)
  union all select '03 the announcement group column exists as uuid', '1',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'ministry_announcements' and column_name = 'public_group_id' and data_type = 'uuid')
  union all select '04 every new object is marked as managed by this migration (4 tables, 1 column, 3 functions, 6 triggers)', '14',
         ((select count(*) from pg_description d where d.classoid = 'pg_class'::regclass and d.objsubid = 0 and d.description = 'managed by 2027-01-05_church_groups_pastors.sql'
             and d.objoid in ('public.church_public_groups'::regclass, 'public.church_group_photos'::regclass, 'public.church_pastors'::regclass, 'public.church_about'::regclass))
          + (select count(*) from pg_description d join pg_attribute a on a.attrelid = d.objoid and a.attnum = d.objsubid where d.classoid = 'pg_class'::regclass and a.attname = 'public_group_id'
               and d.objoid = 'public.ministry_announcements'::regclass and d.description = 'managed by 2027-01-05_church_groups_pastors.sql')
          + (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_phase3_guard', 'church_group_photo_guard', 'ministry_announcement_group_guard') and obj_description(oid, 'pg_proc') = 'managed by 2027-01-05_church_groups_pastors.sql')
          + (select count(*) from pg_trigger where not tgisinternal and tgname in ('church_public_groups_guard_trg', 'church_group_photos_guard_trg', 'church_group_photos_rules_trg', 'church_pastors_guard_trg', 'church_about_guard_trg', 'ministry_announcements_group_trg')
               and obj_description(oid, 'pg_trigger') = 'managed by 2027-01-05_church_groups_pastors.sql'))::text
  union all select '05 the public (anon) can read the display columns', 'true',
         (select (has_column_privilege('anon', 'public.church_public_groups', 'leader_name', 'select') and has_column_privilege('anon', 'public.church_group_photos', 'image_url', 'select')
                  and has_column_privilege('anon', 'public.church_pastors', 'name', 'select') and has_column_privilege('anon', 'public.church_about', 'vision_en', 'select')
                  and has_column_privilege('anon', 'public.ministry_announcements', 'public_group_id', 'select'))::text)
  union all select '06 the public cannot read the roster link or any audit column', '0',
         (select count(*)::text from (values ('church_public_groups', 'roster_group_id'), ('church_public_groups', 'created_by'), ('church_public_groups', 'updated_by'), ('church_group_photos', 'created_by'), ('church_pastors', 'created_by'), ('church_pastors', 'updated_by'), ('church_about', 'updated_by')) x(t, c)
                 where has_column_privilege('anon', 'public.' || x.t, x.c, 'select'))
  union all select '07 neither anon nor PUBLIC can write anything in the new tables', '0',
         (select count(*)::text from unnest(array['church_public_groups', 'church_group_photos', 'church_pastors', 'church_about']) t, unnest(array['anon', 'public']) r, unnest(array['insert', 'update', 'delete']) k where has_table_privilege(r, 'public.' || t, k))
  union all select '08 the three guard functions are callable by nobody (only the triggers run them)', '0',
         (select count(*)::text from unnest(array['church_phase3_guard()', 'church_group_photo_guard()', 'ministry_announcement_group_guard()']) f, unnest(array['anon', 'authenticated', 'public']) r where has_function_privilege(r, 'public.' || f, 'execute'))
  union all select '09 every new table has the platform-admin restriction (4 expected)', '4',
         (select count(*)::text from pg_policy p where p.polname in ('church_public_groups_no_platform_admin', 'church_group_photos_no_platform_admin', 'church_pastors_no_platform_admin', 'church_about_no_platform_admin') and p.polpermissive = false)
  union all select '10 each public read policy needs a published row on a published church (4 expected)', '4',
         (select count(*)::text from pg_policy p where p.polname in ('church_public_groups_public_select', 'church_group_photos_public_select', 'church_pastors_public_select', 'church_about_public_select')
            and pg_get_expr(p.polqual, p.polrelid) ilike '%published%')
  union all select '11 the four group kinds are enforced and a church has at most one group of each kind', 'true',
         (select (exists (select 1 from pg_constraint where conname = 'church_public_groups_kind_check') and exists (select 1 from pg_constraint where conname = 'church_public_groups_kind_key'))::text)
  union all select '12 no money-like or personal contact column in the new tables (0 expected)', '0',
         (select count(*)::text from information_schema.columns c where c.table_schema = 'public' and c.table_name in ('church_public_groups', 'church_group_photos', 'church_pastors', 'church_about')
            and c.column_name ~* '(amount|price|currency|money|fee|commission|payment|payout|refund|receipt|balance|phone|email|birth)')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
