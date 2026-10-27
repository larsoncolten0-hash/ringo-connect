-- VERIFY for 2027-01-08_church_push.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog only: no preference, notification or delivery is read.

with
checks(label, expect, actual) as (
  select '01 the three tables exist with row-level security on', '3',
         (select count(*)::text from pg_class c where c.oid in ('public.church_push_prefs'::regclass, 'public.church_push_outbox'::regclass, 'public.church_push_deliveries'::regclass) and c.relrowsecurity)
  union all select '02 every new object is marked as managed by this migration (3 tables, 6 functions, 1 trigger)', '10',
         ((select count(*) from pg_description d where d.classoid = 'pg_class'::regclass and d.objsubid = 0 and d.description = 'managed by 2027-01-08_church_push.sql'
             and d.objoid in ('public.church_push_prefs'::regclass, 'public.church_push_outbox'::regclass, 'public.church_push_deliveries'::regclass))
          + (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_push_prefs_guard', 'church_push_enqueue', 'church_push_claim', 'church_push_recipients', 'church_push_record', 'church_push_finish') and obj_description(oid, 'pg_proc') = 'managed by 2027-01-08_church_push.sql')
          + (select count(*) from pg_trigger where not tgisinternal and tgname = 'church_push_prefs_guard_trg' and obj_description(oid, 'pg_trigger') = 'managed by 2027-01-08_church_push.sql'))::text
  union all select '03 the tables are closed to every API role and have no policy', '0',
         ((select count(*) from unnest(array['church_push_prefs', 'church_push_outbox', 'church_push_deliveries']) t, unnest(array['anon', 'authenticated', 'public']) r, unnest(array['select', 'insert', 'update', 'delete']) k where has_table_privilege(r, 'public.' || t, k))
          + (select count(*) from pg_policy where polrelid in ('public.church_push_prefs'::regclass, 'public.church_push_outbox'::regclass, 'public.church_push_deliveries'::regclass)))::text
  union all select '04 the five service functions can be called by the service role ONLY', '5/0',
         (select count(*)::text from unnest(array['church_push_enqueue(uuid, text, text, timestamptz, jsonb)', 'church_push_claim(integer)', 'church_push_recipients(uuid, integer)', 'church_push_record(uuid, uuid, boolean)', 'church_push_finish(uuid, text)']) f where has_function_privilege('service_role', 'public.' || f, 'execute'))
         || '/' ||
         (select count(*)::text from unnest(array['church_push_prefs_guard()', 'church_push_enqueue(uuid, text, text, timestamptz, jsonb)', 'church_push_claim(integer)', 'church_push_recipients(uuid, integer)', 'church_push_record(uuid, uuid, boolean)', 'church_push_finish(uuid, text)']) f, unnest(array['anon', 'authenticated', 'public']) r where has_function_privilege(r, 'public.' || f, 'execute'))
  union all select '05 the topic list and the daily cap are in the database (check constraint, recipients function)', 'true',
         (select (exists (select 1 from pg_constraint where conname = 'church_push_prefs_topics_check') and position('interval ''24 hours''' in pg_get_functiondef('public.church_push_recipients(uuid, integer)'::regprocedure)) > 0)::text)
  union all select '06 a notification is queued once per church, kind and reference (unique) and a payload is small (check)', 'true',
         (select (exists (select 1 from pg_constraint where conname = 'church_push_outbox_once_key') and exists (select 1 from pg_constraint where conname = 'church_push_outbox_payload_check'))::text)
  union all select '07 the recipients function returns only the visitor id, language and plan start (3 columns)', '3',
         (select count(*)::text from unnest((select proargnames from pg_proc where oid = 'public.church_push_recipients(uuid, integer)'::regprocedure)) n where n in ('customer_id', 'lang', 'start_date'))
  union all select '08 no personal or money column in the new tables (0 expected)', '0',
         (select count(*)::text from information_schema.columns c where c.table_schema = 'public' and c.table_name in ('church_push_prefs', 'church_push_outbox', 'church_push_deliveries')
            and c.column_name ~* '(name|phone|email|amount|price|currency|money|fee|payment|balance|endpoint|p256dh|auth)')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
