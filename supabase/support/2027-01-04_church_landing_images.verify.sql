-- VERIFY for 2027-01-04_church_landing_images.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog only: no event, announcement, care case or testimony is created, read or changed.

with
checks(label, expect, actual) as (
  select '01 the picture column exists on events, announcements and care cases, as text', '3',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and column_name = 'image_url' and data_type = 'text'
            and table_name in ('ministry_events', 'ministry_announcements', 'ministry_care_cases'))
  union all select '02 the care picture confirmation exists as a boolean that is never null and defaults to false', '1',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'ministry_care_cases' and column_name = 'image_consent'
            and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false')
  union all select '03 the four constraints exist (three address shapes, one care confirmation rule)', '4',
         (select count(*)::text from pg_constraint where conname in ('ministry_events_image_url_check', 'ministry_announcements_image_url_check', 'ministry_care_cases_image_url_check', 'ministry_care_cases_image_consent_check'))
  union all select '04 every new object is marked as managed by this migration (3 picture columns, the confirmation column, 2 functions, 1 trigger)', '7',
         ((select count(*) from pg_description d join pg_attribute a on a.attrelid = d.objoid and a.attnum = d.objsubid
            where d.classoid = 'pg_class'::regclass and a.attname in ('image_url', 'image_consent') and d.description = 'managed by 2027-01-04_church_landing_images.sql'
              and d.objoid in ('public.ministry_events'::regclass, 'public.ministry_announcements'::regclass, 'public.ministry_care_cases'::regclass))
          + (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('ministry_testimonies_public_week', 'ministry_care_image_guard') and obj_description(oid, 'pg_proc') = 'managed by 2027-01-04_church_landing_images.sql')
          + (select count(*) from pg_trigger where not tgisinternal and tgname = 'ministry_care_cases_image_trg' and obj_description(oid, 'pg_trigger') = 'managed by 2027-01-04_church_landing_images.sql'))::text
  union all select '05 the public (anon) can read the three pictures but NOT the care picture confirmation', 'true/false',
         (select (has_column_privilege('anon', 'public.ministry_events', 'image_url', 'select') and has_column_privilege('anon', 'public.ministry_announcements', 'image_url', 'select')
                  and has_column_privilege('anon', 'public.ministry_care_cases', 'image_url', 'select'))::text) || '/' ||
         (select has_column_privilege('anon', 'public.ministry_care_cases', 'image_consent', 'select')::text)
  union all select '06 neither anon nor PUBLIC can write a picture or the confirmation', '0',
         (select count(*)::text from (values ('ministry_events', 'image_url'), ('ministry_announcements', 'image_url'), ('ministry_care_cases', 'image_url'), ('ministry_care_cases', 'image_consent')) x(t, c),
                 unnest(array['anon', 'public']) r, unnest(array['insert', 'update']) k where has_column_privilege(r, 'public.' || x.t, x.c, k))
  union all select '07 signed-in staff can read and write the pictures and the confirmation (the row policies still decide which rows)', '0',
         (select count(*)::text from (values ('ministry_events', 'image_url'), ('ministry_announcements', 'image_url'), ('ministry_care_cases', 'image_url'), ('ministry_care_cases', 'image_consent')) x(t, c),
                 unnest(array['select', 'insert', 'update']) k where not has_column_privilege('authenticated', 'public.' || x.t, x.c, k))
  union all select '08 the picture guard function is callable by nobody (only the trigger runs it)', '0',
         (select count(*)::text from unnest(array['anon', 'authenticated', 'public']) r where has_function_privilege(r, 'public.ministry_care_image_guard()', 'execute'))
  union all select '09 the week function is callable by anon and authenticated, not by PUBLIC', 'true/true/false',
         has_function_privilege('anon', 'public.ministry_testimonies_public_week(uuid, timestamptz, integer)', 'execute')::text || '/' ||
         has_function_privilege('authenticated', 'public.ministry_testimonies_public_week(uuid, timestamptz, integer)', 'execute')::text || '/' ||
         has_function_privilege('public', 'public.ministry_testimonies_public_week(uuid, timestamptz, integer)', 'execute')::text
  union all select '10 no care case holds a picture without the recorded confirmation (0 expected)', '0',
         (select count(*)::text from public.ministry_care_cases where image_url is not null and not image_consent)
  union all select '11 the public read policy of care cases is still the one that needs a granted consent (a picture is only ever public with its published, consented case)', 'true',
         (select (count(*) = 1)::text from pg_policy p where p.polrelid = 'public.ministry_care_cases'::regclass and p.polname = 'ministry_care_cases_public_select'
            and pg_get_expr(p.polqual, p.polrelid) ilike '%consent_state%granted%' and pg_get_expr(p.polqual, p.polrelid) ilike '%published%')
  union all select '12 still no money-like column on the three tables (0 expected)', '0',
         (select count(*)::text from information_schema.columns c where c.table_schema = 'public' and c.table_name in ('ministry_events', 'ministry_announcements', 'ministry_care_cases')
            and c.column_name ~* '(amount|price|currency|money|fee|commission|payment|payout|refund|receipt|balance)')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
