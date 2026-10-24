-- VERIFY for 2027-01-02_ministry_care_cases.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog only: no care case, consent record or beneficiary link is created, read or changed.

with
checks(label, expect, actual) as (
  select '01 the three tables exist and are managed by this migration', '3',
         (select count(*)::text from unnest(array['ministry_care_cases', 'ministry_care_beneficiaries', 'ministry_care_consents']) t
           where obj_description(to_regclass('public.' || t), 'pg_class') = 'managed by 2027-01-02_ministry_care_cases.sql')
  union all select '02 row-level security is on for all three', '3',
         (select count(*)::text from pg_class where oid in (to_regclass('public.ministry_care_cases'), to_regclass('public.ministry_care_beneficiaries'), to_regclass('public.ministry_care_consents')) and relrowsecurity)
  union all select '03 PUBLIC and anon have no table-level privilege of any kind on any of them', '0',
         (select count(*)::text from unnest(array['ministry_care_cases', 'ministry_care_beneficiaries', 'ministry_care_consents']) t, unnest(array['public', 'anon']) r,
                 unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) k where has_table_privilege(r, 'public.' || t, k))
  union all select '04 anon can write nothing and can read nothing of the beneficiary and consent tables', '0',
         (select (has_any_column_privilege('anon', 'public.ministry_care_cases', 'insert') or has_any_column_privilege('anon', 'public.ministry_care_cases', 'update')
                  or has_any_column_privilege('anon', 'public.ministry_care_beneficiaries', 'select') or has_any_column_privilege('anon', 'public.ministry_care_consents', 'select'))::int::text)
  union all select '05 anon can read the public content of a case but NOT its consent state', '1/0',
         ((select has_column_privilege('anon', 'public.ministry_care_cases', 'title_en', 'select')::int::text) || '/' || (select has_column_privilege('anon', 'public.ministry_care_cases', 'consent_state', 'select')::int::text))
  union all select '06 nobody can write the derived consent state, and the audit columns are out of reach of every API role', '0',
         ((select (has_column_privilege('authenticated', 'public.ministry_care_cases', 'consent_state', 'insert') or has_column_privilege('authenticated', 'public.ministry_care_cases', 'consent_state', 'update'))::int
           + (select count(*) from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update']) k,
                     (values ('ministry_care_cases', 'created_by'), ('ministry_care_cases', 'updated_by'), ('ministry_care_cases', 'published_by'), ('ministry_care_beneficiaries', 'created_by'),
                             ('ministry_care_beneficiaries', 'updated_by'), ('ministry_care_consents', 'recorded_by')) c(t, col)
               where has_column_privilege(r, 'public.' || c.t, c.col, k)))::text)
  union all select '07 a consent record can be neither updated nor deleted by an API role', '0',
         (select (has_any_column_privilege('authenticated', 'public.ministry_care_consents', 'update') or has_table_privilege('authenticated', 'public.ministry_care_consents', 'delete'))::int::text)
  union all select '08 authenticated cannot update profile_id, and cannot truncate, reference or trigger any table', '0',
         (select count(*)::text from unnest(array['ministry_care_cases', 'ministry_care_beneficiaries', 'ministry_care_consents']) t
           where has_column_privilege('authenticated', 'public.' || t, 'profile_id', 'update') or has_table_privilege('authenticated', 'public.' || t, 'truncate')
              or has_table_privilege('authenticated', 'public.' || t, 'references') or has_table_privilege('authenticated', 'public.' || t, 'trigger'))
  union all select '09 policies: cases 5+3, beneficiaries 4+3, consents 2+1 (permissive+restrictive), none for PUBLIC', '5+3,4+3,2+1,0',
         ((select count(*) filter (where polpermissive) || '+' || count(*) filter (where not polpermissive) from pg_policy where polrelid = to_regclass('public.ministry_care_cases')) || ',' ||
          (select count(*) filter (where polpermissive) || '+' || count(*) filter (where not polpermissive) from pg_policy where polrelid = to_regclass('public.ministry_care_beneficiaries')) || ',' ||
          (select count(*) filter (where polpermissive) || '+' || count(*) filter (where not polpermissive) from pg_policy where polrelid = to_regclass('public.ministry_care_consents')) || ',' ||
          (select count(*) from pg_policy where polrelid in (to_regclass('public.ministry_care_cases'), to_regclass('public.ministry_care_beneficiaries'), to_regclass('public.ministry_care_consents')) and polroles = array[0::oid]))
  union all select '10 the public read policy requires published AND consent granted', '1',
         (select count(*)::text from pg_policy where polrelid = to_regclass('public.ministry_care_cases') and polname = 'ministry_care_cases_public_select'
             and pg_get_expr(polqual, polrelid) like '%consent_state%granted%' and pg_get_expr(polqual, polrelid) like '%published%')
  union all select '11 the four triggers exist', '4',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('ministry_care_cases_guard_trg', 'ministry_care_beneficiaries_guard_trg', 'ministry_care_consents_guard_trg', 'ministry_care_consents_applied_trg'))
  union all select '12 the four functions exist, are managed by this migration, security definer with a pinned search_path', '4',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('ministry_care_case_guard', 'ministry_care_beneficiary_guard', 'ministry_care_consent_guard', 'ministry_care_consent_applied')
             and obj_description(oid, 'pg_proc') = 'managed by 2027-01-02_ministry_care_cases.sql' and prosecdef and proconfig::text like '%search_path=pg_catalog, public, pg_temp%')
  union all select '13 no guard function is callable by PUBLIC, anon or authenticated', '0',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('ministry_care_case_guard', 'ministry_care_beneficiary_guard', 'ministry_care_consent_guard', 'ministry_care_consent_applied')
             and (has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('public', oid, 'execute')))
  union all select '14 NO money-like column exists in any care table (no amount, target, currency, fee, payment, payout, refund, receipt)', '0',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name like 'ministry\_care%' and column_name ~* '(amount|price|target|currency|money|fee|commission|payment|payout|refund|receipt|balance)')
  union all select '15 no relation named ministry_care* other than the three tables (and their keys and indexes) exists', '0',
         (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace and relname like 'ministry\_care%'
             and relname not in ('ministry_care_cases', 'ministry_care_cases_pkey', 'ministry_care_cases_id_profile_key', 'ministry_care_cases_profile_idx',
                                 'ministry_care_beneficiaries', 'ministry_care_beneficiaries_pkey', 'ministry_care_beneficiaries_member_idx',
                                 'ministry_care_consents', 'ministry_care_consents_pkey', 'ministry_care_consents_case_idx', 'ministry_care_consents_seq_seq'))
  union all select '16 no relation named church_* other than the four Phase 2A tables was added (Phase 0 verify row 10 still holds)', '0',
         (select count(*)::text from pg_tables where schemaname = 'public' and tablename like 'church\_%' and tablename not in ('church_members', 'church_groups', 'church_group_members', 'church_leadership'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
