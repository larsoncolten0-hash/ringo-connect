-- Churches & Ministries Phase 9: Care & Support (CASE AND CONSENT DATA LAYER ONLY) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Adds THREE tables and four guard functions. Nothing existing is changed: no table, column, constraint, policy, trigger or function of Phase 0, Phase 2A, Phases 3-8, Team, payments, shops or anything else
-- is altered, and no row is read or written. It CALLS (never modifies) the Phase 2A helpers is_church_profile(), church_is_owner() and church_has_permission(), and the platform's is_admin().
--
--   NEW  public.ministry_care_cases          one care / assistance case of a church: a title and a short story in English and/or French, a category, a draft / published status
--   NEW  public.ministry_care_beneficiaries  PRIVATE link from a case to the roster person it is for (never a child). Staff only. Never public, never in a report, never in Ringo AI.
--   NEW  public.ministry_care_consents       the APPEND-ONLY record of the beneficiary's (or guardian's) consent to show the case publicly: granted or withdrawn, by whom, how
--   NEW  functions ministry_care_case_guard(), ministry_care_beneficiary_guard(), ministry_care_consent_guard(), ministry_care_consent_applied()
--
-- WHAT THIS IS NOT: there is NO money anywhere in this file. No amount, target, currency, contribution, payment, ledger, refund, payout, fee, commission, receipt or account of any kind. Collecting money for a
-- case is a later phase that needs decisions that are not made yet (fees, settlement, verification, refunds, over-target, early closure, legal classification). No table here can hold a payment.
--
-- PRIVACY RULES THE DATABASE ENFORCES (for every writer, the service role included)
--   * a case is PRIVATE by default: it is created as a draft and nobody but permitted staff can read it;
--   * a case can be PUBLISHED only while the latest consent record is "granted" (error care_consent_required otherwise);
--   * WITHDRAWING consent unpublishes the case immediately, in the same statement (a trigger), and it cannot be published again until a new "granted" record is added;
--   * the public read policy ALSO requires consent_state = 'granted', so even a row that somehow said "published" is not public without consent;
--   * consent records can never be edited and no API role can delete one (they go only when the case itself is deleted);
--   * the person a case is for is stored in a SEPARATE staff-only table, so no public column of a published case can ever reveal who it is; a CHILD can never be linked (link the guardian instead);
--   * anon can read ONLY the content columns of a published, consented case of a published church. The audit columns are readable and writable by NO API role.
--
-- PERMISSIONS (strings stored in organization_roles.permissions like every other permission; church_has_permission() already answers for any string)
--   church.care.view      read every case of the church, drafts included, with its consent record and beneficiary link
--   church.care.manage    create, edit and delete DRAFT cases; link the beneficiary; record consent (granted or withdrawn)
--   church.care.publish   publish and unpublish, and edit or delete a LIVE case
--   The owner of a church implicitly holds all three. The Phase 2A grant guards treat every church.* string they do not list as SENSITIVE (OWNER-ONLY to grant), so no Phase 2A object changes.
--
-- SELF-VERIFYING, one transaction: preconditions first, postconditions last. Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-12-27_church_people_groups.sql (church_members, is_church_profile, church_is_owner, church_has_permission), is_admin().
-- Preflight (read-only, run BEFORE): supabase/support/2027-01-02_ministry_care_cases.preflight.sql
-- Verify    (read-only, run AFTER):  supabase/support/2027-01-02_ministry_care_cases.verify.sql
-- Rollback: supabase/support/2027-01-02_ministry_care_cases.rollback.sql (refuses to run while any row exists unless data loss is explicitly confirmed).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS + a snapshot of the objects this file must leave untouched
-- ----------------------------------------------------------------------------
do $$
declare
  v_marker constant text := 'managed by 2027-01-02_ministry_care_cases.sql';
  v_missing text;
  v_bad text;
  v_have int := (select count(*) from unnest(array['ministry_care_cases', 'ministry_care_beneficiaries', 'ministry_care_consents']) t where to_regclass('public.' || t) is not null);
begin
  select string_agg(t, ', ') into v_missing from unnest(array['profiles', 'users', 'church_members']) t where to_regclass('public.' || t) is null;
  if v_missing is not null then raise exception 'precondition failed: missing tables (is Phase 2A applied?): %', v_missing; end if;

  select string_agg(f, ', ') into v_missing
    from unnest(array['public.is_admin()', 'public.is_church_profile(uuid)', 'public.church_is_owner(uuid)', 'public.church_has_permission(uuid, text)']) f
   where to_regprocedure(f) is null;
  if v_missing is not null then raise exception 'precondition failed: missing functions (is Phase 2A applied?): %', v_missing; end if;

  select string_agg(c, ', ') into v_missing from unnest(array['published']) c
   where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = c);
  if v_missing is not null then raise exception 'precondition failed: public.profiles is missing columns: %', v_missing; end if;

  select string_agg(c, ', ') into v_missing from unnest(array['age_group', 'profile_id']) c
   where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'church_members' and column_name = c);
  if v_missing is not null then raise exception 'precondition failed: public.church_members is missing columns: %', v_missing; end if;

  select string_agg(r, ', ') into v_missing from unnest(array['anon', 'authenticated', 'service_role']) r where not exists (select 1 from pg_roles where rolname = r);
  if v_missing is not null then raise exception 'precondition failed: missing database roles: %', v_missing; end if;

  -- the Phase 2A policy helpers must be the real ones (the marker proves they were created by that migration)
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('is_church_profile', 'church_is_owner', 'church_has_permission')
     and coalesce(obj_description(p.oid, 'pg_proc'), '') <> 'managed by 2026-12-27_church_people_groups.sql';
  if v_bad is not null then raise exception 'precondition failed: % is not managed by the Phase 2A migration', v_bad; end if;

  -- the composite key the beneficiary link points at
  if not exists (select 1 from pg_constraint where conrelid = 'public.church_members'::regclass and conname = 'church_members_id_profile_key') then
    raise exception 'precondition failed: church_members_id_profile_key is missing (is Phase 2A applied?)';
  end if;

  -- half-applied guard: either none of the three tables exists (first run) or all do (re-run)
  if v_have not in (0, 3) then raise exception 'precondition failed: only % of the 3 care tables exist (half-applied state); resolve it before running this file', v_have; end if;
  if v_have = 3 then
    select string_agg(t, ', ') into v_bad from unnest(array['ministry_care_cases', 'ministry_care_beneficiaries', 'ministry_care_consents']) t where coalesce(obj_description(to_regclass('public.' || t), 'pg_class'), '') <> v_marker;
    if v_bad is not null then raise exception 'precondition failed: table(s) % already exist but are not managed by this migration; refusing to adopt or re-mark them', v_bad; end if;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('ministry_care_case_guard', 'ministry_care_beneficiary_guard', 'ministry_care_consent_guard', 'ministry_care_consent_applied')
     and (v_have = 0 or coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker);
  if v_bad is not null then raise exception 'precondition failed: a function with one of this file''s names already exists and is not managed by it: %', v_bad; end if;
  if v_have = 0 then
    select string_agg(c.relname, ', ') into v_bad from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'ministry\_care%';
    if v_bad is not null then raise exception 'precondition failed: relations named ministry_care* already exist: %', v_bad; end if;
  end if;

  perform set_config('ministry_care.pre', jsonb_build_object(
    'profiles',     (select count(*) from public.profiles),
    'users',        (select count(*) from public.users),
    'members',      (select count(*) from public.church_members),
    'org_roles',    (select count(*) from public.organization_roles),
    'org_members',  (select count(*) from public.organization_members),
    'policies',     (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
                       from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass,
                                                              'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass)
                          or p.polrelid = to_regclass('public.daily_words') or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.ministry_announcements')
                          or p.polrelid = to_regclass('public.ministry_attendance') or p.polrelid = to_regclass('public.ministry_attendance_counts') or p.polrelid = to_regclass('public.ministry_music_links')
                          or p.polrelid = to_regclass('public.bible_programs')),
    'fn_defs',      (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
                       from pg_proc f where f.pronamespace = 'public'::regnamespace
                        and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname like 'bible\_%'
                             or (f.proname like 'ministry\_%' and f.proname not in ('ministry_care_case_guard', 'ministry_care_beneficiary_guard', 'ministry_care_consent_guard', 'ministry_care_consent_applied'))
                             or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile')))
  )::text, true);
end $$;

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.ministry_care_cases (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- a case is created as a draft; only the guard (with a granted consent) lets it become 'published'
  status text not null default 'draft',
  category text not null default 'other',
  -- what the PUBLIC may read once published: written by the church, in English and/or French
  title_en text,
  title_fr text,
  summary_en text,
  summary_fr text,
  -- derived by the guard from the latest consent record; NO API role can write it
  consent_state text not null default 'none',
  published_at timestamptz,
  -- audit columns: filled by ministry_care_case_guard from auth.uid(); NOT readable or writable by any API role
  published_by uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- target of the composite foreign keys of the two child tables: they can only ever point at a case of the SAME church
  constraint ministry_care_cases_id_profile_key unique (id, profile_id),
  constraint ministry_care_cases_status_check check (status in ('draft', 'published')),
  constraint ministry_care_cases_category_check check (category in ('medical', 'education', 'bereavement', 'housing', 'food', 'other')),
  constraint ministry_care_cases_consent_state_check check (consent_state in ('none', 'granted', 'withdrawn')),
  constraint ministry_care_cases_published_at_check check ((status = 'published') = (published_at is not null)),
  -- the database repeats the rule: a published case has a granted consent
  constraint ministry_care_cases_published_consent_check check (status <> 'published' or consent_state = 'granted'),
  constraint ministry_care_cases_title_en_check check (title_en is null or char_length(title_en) between 1 and 120),
  constraint ministry_care_cases_title_fr_check check (title_fr is null or char_length(title_fr) between 1 and 120),
  constraint ministry_care_cases_summary_en_check check (summary_en is null or char_length(summary_en) between 1 and 2000),
  constraint ministry_care_cases_summary_fr_check check (summary_fr is null or char_length(summary_fr) between 1 and 2000),
  -- a published case is readable in at least one language: a title AND a summary in English, or a title AND a summary in French
  constraint ministry_care_cases_publish_content_check check (
    status <> 'published'
    or (nullif(btrim(title_en), '') is not null and nullif(btrim(summary_en), '') is not null)
    or (nullif(btrim(title_fr), '') is not null and nullif(btrim(summary_fr), '') is not null)
  )
);
create index if not exists ministry_care_cases_profile_idx on public.ministry_care_cases (profile_id, created_at desc);

-- PRIVATE: who the case is for. One person per case, never a child, never public.
create table if not exists public.ministry_care_beneficiaries (
  case_id uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  member_id uuid not null,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ministry_care_beneficiaries_case_fk foreign key (case_id, profile_id) references public.ministry_care_cases (id, profile_id) on delete cascade,
  -- erasing a person from the roster erases their link with them (the case itself stays, unlinked)
  constraint ministry_care_beneficiaries_member_fk foreign key (member_id, profile_id) references public.church_members (id, profile_id) on delete cascade
);
create index if not exists ministry_care_beneficiaries_member_idx on public.ministry_care_beneficiaries (member_id);

-- APPEND-ONLY: one row per decision. The newest row is the current state.
create table if not exists public.ministry_care_consents (
  id uuid primary key default gen_random_uuid(),
  -- strictly increasing: orders decisions even when two share a timestamp
  seq bigint generated always as identity,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  case_id uuid not null,
  kind text not null,
  -- who consented: the person themselves, or a parent / guardian on their behalf (a child, or someone unable to)
  given_by text not null,
  -- how it was given: in writing, or said aloud with a witness
  method text not null,
  recorded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ministry_care_consents_case_fk foreign key (case_id, profile_id) references public.ministry_care_cases (id, profile_id) on delete cascade,
  constraint ministry_care_consents_kind_check check (kind in ('granted', 'withdrawn')),
  constraint ministry_care_consents_given_by_check check (given_by in ('beneficiary', 'guardian')),
  constraint ministry_care_consents_method_check check (method in ('written', 'verbal_witnessed'))
);
create index if not exists ministry_care_consents_case_idx on public.ministry_care_consents (case_id, seq desc);

comment on table public.ministry_care_cases is 'managed by 2027-01-02_ministry_care_cases.sql';
comment on table public.ministry_care_beneficiaries is 'managed by 2027-01-02_ministry_care_cases.sql';
comment on table public.ministry_care_consents is 'managed by 2027-01-02_ministry_care_cases.sql';

-- ----------------------------------------------------------------------------
-- 2. FUNCTIONS
-- ----------------------------------------------------------------------------
-- Integrity and bookkeeping for every writer (the service role included) of ministry_care_cases: only a church profile, the church never changes, the consent state is DERIVED from the consent record
-- (never taken from the writer), a case can be published only with a granted consent and falls back to a private draft the moment consent is not granted, and the audit columns come from the caller.
create or replace function public.ministry_care_case_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_latest text;
begin
  if tg_op = 'INSERT' then
    if not public.is_church_profile(new.profile_id) then
      raise exception 'care_profile_required' using errcode = '23514', detail = 'cases can only be created for a profile with the Churches & Ministries category';
    end if;
    new.consent_state := 'none';
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.updated_by := auth.uid();
    end if;
  else
    if new.profile_id is distinct from old.profile_id then
      raise exception 'care_tenant_immutable' using errcode = '42501', detail = 'a case can never be moved to another church';
    end if;
    select c.kind into v_latest from public.ministry_care_consents c where c.case_id = new.id and c.profile_id = new.profile_id order by c.seq desc limit 1;
    new.consent_state := case v_latest when 'granted' then 'granted' when 'withdrawn' then 'withdrawn' else 'none' end;
    if auth.uid() is not null then
      new.created_by := old.created_by;
      new.updated_by := auth.uid();
    end if;
    new.updated_at := now();
  end if;

  if new.status = 'published' and new.consent_state <> 'granted' then
    if tg_op = 'INSERT' or old.status <> 'published' then
      raise exception 'care_consent_required' using errcode = '23514', detail = 'a case can only be published while the beneficiary''s consent is recorded';
    end if;
    -- already live and consent is no longer granted (withdrawn): it goes back to a private draft, in this very statement
    new.status := 'draft';
  end if;

  if new.status = 'published' then
    if tg_op = 'INSERT' or old.status <> 'published' then
      new.published_at := now();
      new.published_by := coalesce(auth.uid(), new.published_by);
    else
      new.published_at := old.published_at;
      new.published_by := old.published_by;
    end if;
  else
    new.published_at := null;
    new.published_by := null;
  end if;
  return new;
end;
$$;

-- The beneficiary link: the person must be on the roster of THIS church (the composite key proves it) and must not be a child (a child's case is linked to the guardian). Audit from the caller.
create or replace function public.ministry_care_beneficiary_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_age text;
begin
  if tg_op = 'UPDATE' and (new.case_id is distinct from old.case_id or new.profile_id is distinct from old.profile_id) then
    raise exception 'care_tenant_immutable' using errcode = '42501', detail = 'the case and the church of a beneficiary link can never change';
  end if;
  select m.age_group into v_age from public.church_members m where m.id = new.member_id and m.profile_id = new.profile_id;
  if not found then
    raise exception 'care_member_missing' using errcode = '23503', detail = 'no such person in this church';
  end if;
  if v_age = 'child' then
    raise exception 'care_child_not_allowed' using errcode = '23514', detail = 'a child is never linked to a care case; link the guardian';
  end if;
  if auth.uid() is not null then
    if tg_op = 'INSERT' then new.created_by := auth.uid(); new.updated_by := auth.uid();
    else new.created_by := old.created_by; new.updated_by := auth.uid(); end if;
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end;
$$;

-- A consent record is only ever ADDED: never edited. The recorder comes from the authenticated caller.
create or replace function public.ministry_care_consent_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'care_consent_immutable' using errcode = '42501', detail = 'a consent record is added, never edited';
  end if;
  if not public.is_church_profile(new.profile_id) then
    raise exception 'care_profile_required' using errcode = '23514', detail = 'consent can only be recorded for a church';
  end if;
  if auth.uid() is not null then new.recorded_by := auth.uid(); end if;
  return new;
end;
$$;

-- After a consent record is added, the case is touched so its guard re-derives consent_state and, if consent was withdrawn, unpublishes the case in the same transaction.
create or replace function public.ministry_care_consent_applied()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  update public.ministry_care_cases set updated_at = now() where id = new.case_id and profile_id = new.profile_id;
  return null;
end;
$$;

comment on function public.ministry_care_case_guard() is 'managed by 2027-01-02_ministry_care_cases.sql';
comment on function public.ministry_care_beneficiary_guard() is 'managed by 2027-01-02_ministry_care_cases.sql';
comment on function public.ministry_care_consent_guard() is 'managed by 2027-01-02_ministry_care_cases.sql';
comment on function public.ministry_care_consent_applied() is 'managed by 2027-01-02_ministry_care_cases.sql';

revoke all on function public.ministry_care_case_guard() from public, anon, authenticated;
revoke all on function public.ministry_care_beneficiary_guard() from public, anon, authenticated;
revoke all on function public.ministry_care_consent_guard() from public, anon, authenticated;
revoke all on function public.ministry_care_consent_applied() from public, anon, authenticated;

drop trigger if exists ministry_care_cases_guard_trg on public.ministry_care_cases;
create trigger ministry_care_cases_guard_trg before insert or update on public.ministry_care_cases for each row execute function public.ministry_care_case_guard();
comment on trigger ministry_care_cases_guard_trg on public.ministry_care_cases is 'managed by 2027-01-02_ministry_care_cases.sql';
drop trigger if exists ministry_care_beneficiaries_guard_trg on public.ministry_care_beneficiaries;
create trigger ministry_care_beneficiaries_guard_trg before insert or update on public.ministry_care_beneficiaries for each row execute function public.ministry_care_beneficiary_guard();
comment on trigger ministry_care_beneficiaries_guard_trg on public.ministry_care_beneficiaries is 'managed by 2027-01-02_ministry_care_cases.sql';
drop trigger if exists ministry_care_consents_guard_trg on public.ministry_care_consents;
create trigger ministry_care_consents_guard_trg before insert or update on public.ministry_care_consents for each row execute function public.ministry_care_consent_guard();
comment on trigger ministry_care_consents_guard_trg on public.ministry_care_consents is 'managed by 2027-01-02_ministry_care_cases.sql';
drop trigger if exists ministry_care_consents_applied_trg on public.ministry_care_consents;
create trigger ministry_care_consents_applied_trg after insert on public.ministry_care_consents for each row execute function public.ministry_care_consent_applied();
comment on trigger ministry_care_consents_applied_trg on public.ministry_care_consents is 'managed by 2027-01-02_ministry_care_cases.sql';

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY AND PRIVILEGES
-- ----------------------------------------------------------------------------
alter table public.ministry_care_cases enable row level security;
alter table public.ministry_care_beneficiaries enable row level security;
alter table public.ministry_care_consents enable row level security;

revoke all on public.ministry_care_cases from public, anon, authenticated;
revoke all on public.ministry_care_beneficiaries from public, anon, authenticated;
revoke all on public.ministry_care_consents from public, anon, authenticated;

-- cases. anon: the public content columns only. authenticated: those plus the consent state. Never the audit columns.
grant select (id, profile_id, status, category, title_en, title_fr, summary_en, summary_fr, published_at, created_at, updated_at) on public.ministry_care_cases to anon;
grant select (id, profile_id, status, category, title_en, title_fr, summary_en, summary_fr, consent_state, published_at, created_at, updated_at) on public.ministry_care_cases to authenticated;
grant insert (id, profile_id, status, category, title_en, title_fr, summary_en, summary_fr) on public.ministry_care_cases to authenticated;
grant update (status, category, title_en, title_fr, summary_en, summary_fr) on public.ministry_care_cases to authenticated;
grant delete on public.ministry_care_cases to authenticated;
-- beneficiary link: signed-in staff only (anon has nothing)
grant select (case_id, profile_id, member_id, created_at, updated_at) on public.ministry_care_beneficiaries to authenticated;
grant insert (case_id, profile_id, member_id) on public.ministry_care_beneficiaries to authenticated;
grant update (member_id) on public.ministry_care_beneficiaries to authenticated;
grant delete on public.ministry_care_beneficiaries to authenticated;
-- consent record: read and ADD, never change or delete (anon has nothing)
grant select (id, profile_id, case_id, kind, given_by, method, created_at) on public.ministry_care_consents to authenticated;
grant insert (id, profile_id, case_id, kind, given_by, method) on public.ministry_care_consents to authenticated;
grant all on public.ministry_care_cases to service_role;
grant all on public.ministry_care_beneficiaries to service_role;
grant all on public.ministry_care_consents to service_role;

-- ministry_care_cases
drop policy if exists ministry_care_cases_staff_select on public.ministry_care_cases;
create policy ministry_care_cases_staff_select on public.ministry_care_cases for select to authenticated
  using (public.church_has_permission(profile_id, 'church.care.view') or public.church_has_permission(profile_id, 'church.care.manage') or public.church_has_permission(profile_id, 'church.care.publish'));

-- PUBLIC read: published AND consent granted AND the church page is published. A draft, a withdrawn case or a case without consent is never public.
drop policy if exists ministry_care_cases_public_select on public.ministry_care_cases;
create policy ministry_care_cases_public_select on public.ministry_care_cases for select to anon, authenticated
  using (status = 'published' and consent_state = 'granted' and exists (select 1 from public.profiles p where p.id = profile_id and p.published = true));

-- publish permission: anything. manage permission: drafts only, and the row must still be a draft afterwards (so manage alone can never publish).
drop policy if exists ministry_care_cases_insert on public.ministry_care_cases;
create policy ministry_care_cases_insert on public.ministry_care_cases for insert to authenticated
  with check (public.church_has_permission(profile_id, 'church.care.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.care.manage')));
drop policy if exists ministry_care_cases_update on public.ministry_care_cases;
create policy ministry_care_cases_update on public.ministry_care_cases for update to authenticated
  using (public.church_has_permission(profile_id, 'church.care.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.care.manage')))
  with check (public.church_has_permission(profile_id, 'church.care.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.care.manage')));
drop policy if exists ministry_care_cases_delete on public.ministry_care_cases;
create policy ministry_care_cases_delete on public.ministry_care_cases for delete to authenticated
  using (public.church_has_permission(profile_id, 'church.care.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.care.manage')));

drop policy if exists ministry_care_cases_no_platform_admin_insert on public.ministry_care_cases;
create policy ministry_care_cases_no_platform_admin_insert on public.ministry_care_cases as restrictive for insert to authenticated
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists ministry_care_cases_no_platform_admin_update on public.ministry_care_cases;
create policy ministry_care_cases_no_platform_admin_update on public.ministry_care_cases as restrictive for update to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id))
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists ministry_care_cases_no_platform_admin_delete on public.ministry_care_cases;
create policy ministry_care_cases_no_platform_admin_delete on public.ministry_care_cases as restrictive for delete to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id));

-- ministry_care_beneficiaries (staff only: no public policy, anon has no privilege)
drop policy if exists ministry_care_beneficiaries_select on public.ministry_care_beneficiaries;
create policy ministry_care_beneficiaries_select on public.ministry_care_beneficiaries for select to authenticated
  using (public.church_has_permission(profile_id, 'church.care.view') or public.church_has_permission(profile_id, 'church.care.manage') or public.church_has_permission(profile_id, 'church.care.publish'));
drop policy if exists ministry_care_beneficiaries_insert on public.ministry_care_beneficiaries;
create policy ministry_care_beneficiaries_insert on public.ministry_care_beneficiaries for insert to authenticated
  with check (public.church_has_permission(profile_id, 'church.care.manage') or public.church_has_permission(profile_id, 'church.care.publish'));
drop policy if exists ministry_care_beneficiaries_update on public.ministry_care_beneficiaries;
create policy ministry_care_beneficiaries_update on public.ministry_care_beneficiaries for update to authenticated
  using (public.church_has_permission(profile_id, 'church.care.manage') or public.church_has_permission(profile_id, 'church.care.publish'))
  with check (public.church_has_permission(profile_id, 'church.care.manage') or public.church_has_permission(profile_id, 'church.care.publish'));
drop policy if exists ministry_care_beneficiaries_delete on public.ministry_care_beneficiaries;
create policy ministry_care_beneficiaries_delete on public.ministry_care_beneficiaries for delete to authenticated
  using (public.church_has_permission(profile_id, 'church.care.manage') or public.church_has_permission(profile_id, 'church.care.publish'));

drop policy if exists ministry_care_beneficiaries_no_platform_admin_insert on public.ministry_care_beneficiaries;
create policy ministry_care_beneficiaries_no_platform_admin_insert on public.ministry_care_beneficiaries as restrictive for insert to authenticated
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists ministry_care_beneficiaries_no_platform_admin_update on public.ministry_care_beneficiaries;
create policy ministry_care_beneficiaries_no_platform_admin_update on public.ministry_care_beneficiaries as restrictive for update to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id))
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists ministry_care_beneficiaries_no_platform_admin_delete on public.ministry_care_beneficiaries;
create policy ministry_care_beneficiaries_no_platform_admin_delete on public.ministry_care_beneficiaries as restrictive for delete to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id));

-- ministry_care_consents (staff only; read and add; there is NO update or delete policy, so none is possible through the API)
drop policy if exists ministry_care_consents_select on public.ministry_care_consents;
create policy ministry_care_consents_select on public.ministry_care_consents for select to authenticated
  using (public.church_has_permission(profile_id, 'church.care.view') or public.church_has_permission(profile_id, 'church.care.manage') or public.church_has_permission(profile_id, 'church.care.publish'));
drop policy if exists ministry_care_consents_insert on public.ministry_care_consents;
create policy ministry_care_consents_insert on public.ministry_care_consents for insert to authenticated
  with check (public.church_has_permission(profile_id, 'church.care.manage') or public.church_has_permission(profile_id, 'church.care.publish'));
drop policy if exists ministry_care_consents_no_platform_admin_insert on public.ministry_care_consents;
create policy ministry_care_consents_no_platform_admin_insert on public.ministry_care_consents as restrictive for insert to authenticated
  with check (not public.is_admin() or public.church_is_owner(profile_id));

-- ----------------------------------------------------------------------------
-- 4. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
declare
  v_pre jsonb := current_setting('ministry_care.pre')::jsonb;
  v_marker constant text := 'managed by 2027-01-02_ministry_care_cases.sql';
  v_t text;
  v_n int;
  v_bad text;
begin
  foreach v_t in array array['ministry_care_cases', 'ministry_care_beneficiaries', 'ministry_care_consents'] loop
    if coalesce(obj_description(to_regclass('public.' || v_t), 'pg_class'), '') <> v_marker then raise exception 'postcondition failed: table marker on %', v_t; end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || v_t)) then raise exception 'postcondition failed: row-level security is off on %', v_t; end if;

    -- privileges: PUBLIC has nothing; anon has at most column SELECT (cases only); nobody can truncate, reference or trigger
    if has_table_privilege('public', 'public.' || v_t, 'select') or has_table_privilege('public', 'public.' || v_t, 'insert') then raise exception 'postcondition failed: PUBLIC has a table privilege on %', v_t; end if;
    if has_table_privilege('anon', 'public.' || v_t, 'select') or has_table_privilege('anon', 'public.' || v_t, 'insert') or has_table_privilege('anon', 'public.' || v_t, 'update') or has_table_privilege('anon', 'public.' || v_t, 'delete') then
      raise exception 'postcondition failed: anon has a TABLE-level privilege on %', v_t;
    end if;
    if has_any_column_privilege('anon', 'public.' || v_t, 'insert') or has_any_column_privilege('anon', 'public.' || v_t, 'update') then raise exception 'postcondition failed: anon can write %', v_t; end if;
    if v_t <> 'ministry_care_cases' and has_any_column_privilege('anon', 'public.' || v_t, 'select') then raise exception 'postcondition failed: anon can read the private table %', v_t; end if;
    if has_table_privilege('authenticated', 'public.' || v_t, 'truncate') or has_table_privilege('authenticated', 'public.' || v_t, 'references') or has_table_privilege('authenticated', 'public.' || v_t, 'trigger') then
      raise exception 'postcondition failed: authenticated can truncate, reference or trigger %', v_t;
    end if;
    select string_agg(r || '.' || cols.column_name || '.' || k, ', ') into v_bad
      from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update']) k,
           (select column_name from information_schema.columns where table_schema = 'public' and table_name = v_t and column_name in ('created_by', 'updated_by', 'published_by', 'recorded_by')) cols
     where has_column_privilege(r, 'public.' || v_t, cols.column_name, k);
    if v_bad is not null then raise exception 'postcondition failed: audit column reachable on %: %', v_t, v_bad; end if;
    if has_column_privilege('authenticated', 'public.' || v_t, 'profile_id', 'update') then raise exception 'postcondition failed: profile_id is updatable on %', v_t; end if;
    select count(*) into v_n from pg_policy where polrelid = to_regclass('public.' || v_t) and polroles = array[0::oid];
    if v_n <> 0 then raise exception 'postcondition failed: a policy of % applies to PUBLIC', v_t; end if;
  end loop;

  -- the table-specific shape
  if (select count(*) filter (where polpermissive) from pg_policy where polrelid = 'public.ministry_care_cases'::regclass) <> 5
     or (select count(*) filter (where not polpermissive) from pg_policy where polrelid = 'public.ministry_care_cases'::regclass) <> 3 then raise exception 'postcondition failed: policies on ministry_care_cases'; end if;
  if (select count(*) filter (where polpermissive) from pg_policy where polrelid = 'public.ministry_care_beneficiaries'::regclass) <> 4
     or (select count(*) filter (where not polpermissive) from pg_policy where polrelid = 'public.ministry_care_beneficiaries'::regclass) <> 3 then raise exception 'postcondition failed: policies on ministry_care_beneficiaries'; end if;
  if (select count(*) filter (where polpermissive) from pg_policy where polrelid = 'public.ministry_care_consents'::regclass) <> 2
     or (select count(*) filter (where not polpermissive) from pg_policy where polrelid = 'public.ministry_care_consents'::regclass) <> 1 then raise exception 'postcondition failed: policies on ministry_care_consents'; end if;
  -- consent records can be neither updated nor deleted by any API role
  if has_any_column_privilege('authenticated', 'public.ministry_care_consents', 'update') or has_table_privilege('authenticated', 'public.ministry_care_consents', 'delete') then raise exception 'postcondition failed: a consent record can be changed or deleted'; end if;
  -- no API role can write the derived consent state, and the beneficiary is never in a public column
  if has_column_privilege('authenticated', 'public.ministry_care_cases', 'consent_state', 'insert') or has_column_privilege('authenticated', 'public.ministry_care_cases', 'consent_state', 'update') then raise exception 'postcondition failed: consent_state is writable'; end if;
  if has_column_privilege('anon', 'public.ministry_care_cases', 'consent_state', 'select') then raise exception 'postcondition failed: anon can read consent_state'; end if;

  select count(*) into v_n from pg_trigger where not tgisinternal and tgname in ('ministry_care_cases_guard_trg', 'ministry_care_beneficiaries_guard_trg', 'ministry_care_consents_guard_trg', 'ministry_care_consents_applied_trg');
  if v_n <> 4 then raise exception 'postcondition failed: expected 4 triggers, found %', v_n; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('ministry_care_case_guard', 'ministry_care_beneficiary_guard', 'ministry_care_consent_guard', 'ministry_care_consent_applied')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'));
  if v_bad is not null then raise exception 'postcondition failed: a guard function is callable by an API role: %', v_bad; end if;

  -- no money, anywhere
  select string_agg(c.table_name || '.' || c.column_name, ', ') into v_bad from information_schema.columns c
   where c.table_schema = 'public' and c.table_name like 'ministry\_care%' and c.column_name ~* '(amount|price|target|currency|money|fee|commission|payment|payout|refund|receipt|balance)';
  if v_bad is not null then raise exception 'postcondition failed: a money-like column exists: %', v_bad; end if;

  -- nothing existing changed
  if (select count(*) from public.profiles) <> (v_pre->>'profiles')::bigint or (select count(*) from public.users) <> (v_pre->>'users')::bigint
     or (select count(*) from public.church_members) <> (v_pre->>'members')::bigint
     or (select count(*) from public.organization_roles) <> (v_pre->>'org_roles')::bigint or (select count(*) from public.organization_members) <> (v_pre->>'org_members')::bigint then
    raise exception 'postcondition failed: a row count of an existing table changed';
  end if;
  if (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
        from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass,
                                               'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass)
                           or p.polrelid = to_regclass('public.daily_words') or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.ministry_announcements')
                           or p.polrelid = to_regclass('public.ministry_attendance') or p.polrelid = to_regclass('public.ministry_attendance_counts') or p.polrelid = to_regclass('public.ministry_music_links')
                           or p.polrelid = to_regclass('public.bible_programs')) is distinct from v_pre->'policies' then
    raise exception 'postcondition failed: a policy of an existing table changed';
  end if;
  if (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
        from pg_proc f where f.pronamespace = 'public'::regnamespace
         and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname like 'bible\_%'
              or (f.proname like 'ministry\_%' and f.proname not in ('ministry_care_case_guard', 'ministry_care_beneficiary_guard', 'ministry_care_consent_guard', 'ministry_care_consent_applied'))
              or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile'))) is distinct from v_pre->'fn_defs' then
    raise exception 'postcondition failed: an existing function changed';
  end if;
end $$;

commit;
