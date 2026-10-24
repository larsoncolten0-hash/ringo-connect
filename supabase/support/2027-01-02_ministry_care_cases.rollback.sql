-- ROLLBACK for 2027-01-02_ministry_care_cases.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration created: public.ministry_care_consents, public.ministry_care_beneficiaries and public.ministry_care_cases (their policies, indexes, constraints and triggers go with
-- them) and the four ministry_care_* guard functions. It touches no existing table, row, policy, trigger or function (events, attendance, music, Bible and Phase 2A / 3 objects stay exactly as they
-- are), and it proves that at the end.
--
-- DATA SAFETY: the tables hold care cases and, above all, consent records and the link to the person a case is for. This file REFUSES to run while any row exists. To drop them anyway, first
-- export what you need and then confirm the loss explicitly by adding this line as the FIRST statement inside the transaction (same script, same transaction):
--     select set_config('ministry_care.allow_data_loss', 'yes', true);
-- Dropping a table is irreversible; there is no soft rollback. Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_marker constant text := 'managed by 2027-01-02_ministry_care_cases.sql';
  v_bad text;
  v_t text;
  v_rows bigint := 0;
begin
  -- never drop anything that is not provably this migration's own
  foreach v_t in array array['ministry_care_cases', 'ministry_care_beneficiaries', 'ministry_care_consents'] loop
    if to_regclass('public.' || v_t) is not null and coalesce(obj_description(to_regclass('public.' || v_t), 'pg_class'), '') <> v_marker then
      raise exception 'rollback refused: public.% exists but is not managed by this migration', v_t;
    end if;
  end loop;
  if to_regclass('public.ministry_care_cases') is not null then v_rows := v_rows + (select count(*) from public.ministry_care_cases); end if;
  if to_regclass('public.ministry_care_beneficiaries') is not null then v_rows := v_rows + (select count(*) from public.ministry_care_beneficiaries); end if;
  if to_regclass('public.ministry_care_consents') is not null then v_rows := v_rows + (select count(*) from public.ministry_care_consents); end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('ministry_care_case_guard', 'ministry_care_beneficiary_guard', 'ministry_care_consent_guard', 'ministry_care_consent_applied')
     and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: function(s) % exist but are not managed by this migration', v_bad; end if;

  if v_rows > 0 and coalesce(current_setting('ministry_care.allow_data_loss', true), '') <> 'yes' then
    raise exception 'rollback refused: the tables hold % row(s). Export what you need, then confirm the loss with: select set_config(''ministry_care.allow_data_loss'', ''yes'', true);', v_rows;
  end if;

  perform set_config('ministry_care.pre', jsonb_build_object(
    'profiles',  (select count(*) from public.profiles),
    'members',   (select count(*) from public.church_members),
    'policies',  (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
                    from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass,
                                                           'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass)
                       or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.ministry_announcements') or p.polrelid = to_regclass('public.daily_words')
                       or p.polrelid = to_regclass('public.ministry_attendance') or p.polrelid = to_regclass('public.ministry_music_links') or p.polrelid = to_regclass('public.bible_programs')),
    'fn_defs',   (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
                    from pg_proc f where f.pronamespace = 'public'::regnamespace
                     and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname like 'bible\_%'
                          or (f.proname like 'ministry\_%' and f.proname not like 'ministry\_care\_%')
                          or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile')))
  )::text, true);
end $$;

-- children first (the foreign keys point from the consent record and the link to the case)
drop table if exists public.ministry_care_consents;
drop table if exists public.ministry_care_beneficiaries;
drop table if exists public.ministry_care_cases;
drop function if exists public.ministry_care_consent_applied();
drop function if exists public.ministry_care_consent_guard();
drop function if exists public.ministry_care_beneficiary_guard();
drop function if exists public.ministry_care_case_guard();

do $$
declare
  v_pre jsonb := current_setting('ministry_care.pre')::jsonb;
begin
  if exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname like 'ministry\_care%') then raise exception 'rollback postcondition failed: a ministry_care relation remains'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'ministry\_care%') then raise exception 'rollback postcondition failed: a function remains'; end if;
  if (select count(*) from public.profiles) <> (v_pre->>'profiles')::bigint or (select count(*) from public.church_members) <> (v_pre->>'members')::bigint then
    raise exception 'rollback postcondition failed: a row count of an existing table changed';
  end if;
  if (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
        from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass,
                                               'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass)
                           or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.ministry_announcements') or p.polrelid = to_regclass('public.daily_words')
                           or p.polrelid = to_regclass('public.ministry_attendance') or p.polrelid = to_regclass('public.ministry_music_links') or p.polrelid = to_regclass('public.bible_programs')) is distinct from v_pre->'policies' then
    raise exception 'rollback postcondition failed: a policy of an existing table changed';
  end if;
  if (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
        from pg_proc f where f.pronamespace = 'public'::regnamespace
         and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname like 'bible\_%'
              or (f.proname like 'ministry\_%' and f.proname not like 'ministry\_care\_%')
              or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile'))) is distinct from v_pre->'fn_defs' then
    raise exception 'rollback postcondition failed: an existing function changed';
  end if;
end $$;

commit;
