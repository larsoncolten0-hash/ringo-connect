-- VERIFY for 2027-01-03_ministry_testimonies.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog only: no testimony is created, read or changed.

with
checks(label, expect, actual) as (
  select '01 both tables exist and are managed by this migration', '2',
         (select count(*)::text from unnest(array['ministry_testimonies', 'ministry_testimony_history']) t
           where obj_description(to_regclass('public.' || t), 'pg_class') = 'managed by 2027-01-03_ministry_testimonies.sql')
  union all select '02 row-level security is on for both', '2',
         (select count(*)::text from pg_class where oid in (to_regclass('public.ministry_testimonies'), to_regclass('public.ministry_testimony_history')) and relrowsecurity)
  union all select '03 PUBLIC and anon have NO privilege of any kind on either table (not even a column)', '0/0',
         (select count(*)::text from unnest(array['ministry_testimonies', 'ministry_testimony_history']) t, unnest(array['public', 'anon']) r,
                 unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) k where has_table_privilege(r, 'public.' || t, k))
         || '/' ||
         (select count(*)::text from unnest(array['ministry_testimonies', 'ministry_testimony_history']) t, unnest(array['select', 'insert', 'update']) k where has_any_column_privilege('anon', 'public.' || t, k))
  union all select '04 authenticated cannot insert or delete a testimony or a history row, nor truncate, reference or trigger', '0',
         (select count(*)::text from unnest(array['ministry_testimonies', 'ministry_testimony_history']) t
           where has_any_column_privilege('authenticated', 'public.' || t, 'insert') or has_table_privilege('authenticated', 'public.' || t, 'delete')
              or has_table_privilege('authenticated', 'public.' || t, 'truncate') or has_table_privilege('authenticated', 'public.' || t, 'references') or has_table_privilege('authenticated', 'public.' || t, 'trigger'))
  union all select '05 the submitter''s own words (name, phone, group, text, language, church) cannot be updated by any API role', '0',
         (select count(*)::text from unnest(array['full_name', 'phone', 'group_label', 'body', 'lang', 'profile_id', 'submission_key', 'consent_at']) c where has_column_privilege('authenticated', 'public.ministry_testimonies', c, 'update'))
  union all select '06 the audit columns and the duplicate-prevention key are out of reach of every API role', '0',
         (select count(*)::text from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update']) k,
                 (values ('ministry_testimonies', 'published_by'), ('ministry_testimonies', 'reviewed_by'), ('ministry_testimonies', 'edited_by'), ('ministry_testimonies', 'submission_key'), ('ministry_testimony_history', 'actor_id')) c(t, col)
           where has_column_privilege(r, 'public.' || c.t, c.col, k))
  union all select '07 the history cannot be updated by an API role', '0', (select has_any_column_privilege('authenticated', 'public.ministry_testimony_history', 'update')::int::text)
  union all select '08 policies: testimonies 2+1 (permissive+restrictive), history 1, none for PUBLIC', '2+1,1,0',
         ((select count(*) filter (where polpermissive) || '+' || count(*) filter (where not polpermissive) from pg_policy where polrelid = to_regclass('public.ministry_testimonies')) || ',' ||
          (select count(*) from pg_policy where polrelid = to_regclass('public.ministry_testimony_history')) || ',' ||
          (select count(*) from pg_policy where polrelid in (to_regclass('public.ministry_testimonies'), to_regclass('public.ministry_testimony_history')) and polroles = array[0::oid]))
  union all select '09 the three triggers exist', '3',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('ministry_testimonies_guard_trg', 'ministry_testimonies_audit_trg', 'ministry_testimony_history_guard_trg'))
  union all select '10 the four functions exist, are managed by this migration, security definer with a pinned search_path', '4',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('ministry_testimony_guard', 'ministry_testimony_audit', 'ministry_testimony_history_guard', 'ministry_testimonies_public')
             and obj_description(oid, 'pg_proc') = 'managed by 2027-01-03_ministry_testimonies.sql' and prosecdef and proconfig::text like '%search_path=pg_catalog, public, pg_temp%')
  union all select '11 the three trigger functions are not callable by PUBLIC, anon or authenticated', '0',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('ministry_testimony_guard', 'ministry_testimony_audit', 'ministry_testimony_history_guard')
             and (has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('public', oid, 'execute')))
  union all select '12 the public function is callable by anon and authenticated, not by PUBLIC, and returns no phone, group, note or status', '1/1/0/0',
         ((select has_function_privilege('anon', 'public.ministry_testimonies_public(uuid)', 'execute')::int::text) || '/' || (select has_function_privilege('authenticated', 'public.ministry_testimonies_public(uuid)', 'execute')::int::text) || '/' ||
          (select has_function_privilege('public', 'public.ministry_testimonies_public(uuid)', 'execute')::int::text) || '/' ||
          (select count(*)::text from pg_proc p, unnest(p.proargnames) a where p.oid = 'public.ministry_testimonies_public(uuid)'::regprocedure and a in ('phone', 'group_label', 'moderation_note', 'review_status', 'publication_status', 'full_name')))
  union all select '13 the check constraints exist and are validated (name, phone, group, body, language, statuses, public text, note, consent, published)', '12',
         (select count(*)::text from pg_constraint where conrelid = to_regclass('public.ministry_testimonies') and contype = 'c' and convalidated)
  union all select '14 the duplicate-prevention key is unique per church', '1',
         (select count(*)::text from pg_constraint where conrelid = to_regclass('public.ministry_testimonies') and conname = 'ministry_testimonies_submission_key' and contype = 'u')
  union all select '15 NO money-like column exists in either table', '0',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name like 'ministry\_testimon%' and column_name ~* '(amount|price|currency|money|fee|commission|payment|payout|refund|receipt|balance)')
  union all select '16 no relation named ministry_testimon* other than the two tables (and their keys and indexes) exists', '0',
         (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace and relname like 'ministry\_testimon%'
             and relname not in ('ministry_testimonies', 'ministry_testimonies_pkey', 'ministry_testimonies_id_profile_key', 'ministry_testimonies_submission_key', 'ministry_testimonies_profile_idx', 'ministry_testimonies_public_idx',
                                 'ministry_testimony_history', 'ministry_testimony_history_pkey', 'ministry_testimony_history_idx', 'ministry_testimony_history_seq_seq'))
  union all select '17 no relation named church_* other than the four Phase 2A tables was added (Phase 0 verify row 10 still holds)', '0',
         (select count(*)::text from pg_tables where schemaname = 'public' and tablename like 'church\_%' and tablename not in ('church_members', 'church_groups', 'church_group_members', 'church_leadership'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
