-- Churches & Ministries: Testimonies (database foundation) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Adds TWO tables, one public read function and five guard/audit functions. Nothing existing is changed: no table, column, constraint, policy, trigger or function of Phase 0, Phase 2A, Phases 3-9, Team,
-- payments or anything else is altered, and no row is read or written. It CALLS (never modifies) the Phase 2A helpers is_church_profile(), church_is_owner() and church_has_permission(), and is_admin().
--
--   NEW  public.ministry_testimonies          one testimony a visitor shared with a church: the submitter's name, phone number, optional group, the text, and two CONSENT flags
--   NEW  public.ministry_testimony_history    the APPEND-ONLY moderation history (written only by a trigger, so no action can skip it)
--   NEW  function ministry_testimonies_public(profile)   the ONLY door to anonymous readers: approved + published + consented testimonies, name only with name consent
--   NEW  functions ministry_testimony_guard(), ministry_testimony_audit(), ministry_testimony_history_guard()
--
-- HOW A TESTIMONY ARRIVES: a visitor's page posts to a server route that validates everything and inserts with the service role (like bookings). NO API role (anon or authenticated) can insert, and anon cannot
-- read the table at all. Only the church's authorized staff can read or moderate its testimonies.
--
-- THE RULES THE DATABASE ENFORCES (for every writer, the service role included)
--   * the submitter's own words (name, phone, group, text, language, the key that prevents duplicates) can NEVER be changed. A staff correction goes in a separate field (public_body) and is logged;
--   * publication consent is given ONLY at submission. Staff can WITHDRAW it (on the submitter's request) but can never grant it, so no administrator can override a refusal;
--   * name consent can exist only together with publication consent, and can likewise only be withdrawn;
--   * a testimony is published only while it is APPROVED and publication consent is held; leaving "approved", rejecting it or withdrawing consent unpublishes it at once, in the same statement;
--   * review (submitted, under review, approved, rejected) and publication (unpublished, published) are separate states; approval alone never publishes;
--   * every review, publication, edit, note and consent change is recorded in the history, with who did it;
--   * the public function recomputes the current state on every call (nothing is cached) and returns no phone number, group, note or moderation detail, and the name only with name consent;
--   * no API role can delete a row: rejected, unpublished and withdrawn records stay privately with the church (removing one is an owner-run action under the retention policy);
--   * the audit columns (reviewed_by, published_by, edited_by, actor_id) are readable and writable by NO API role.
--
-- NOT HERE: no money, no payment, no donation. Testimonies are separate from Care & Support: no table here points to a care case or a beneficiary.
--
-- PERMISSIONS (strings stored in organization_roles.permissions; church_has_permission() answers for any string; the Phase 2A guards make every unlisted church.* string OWNER-ONLY to grant)
--   church.testimonies.view     read every testimony of the church and its history
--   church.testimonies.manage   review (under review, approve, reject), correct the public text, write the private note, withdraw consent, unpublish
--   church.testimonies.publish  everything manage can do, and publish an approved, consented testimony
--   The owner of a church implicitly holds all three.
--
-- SELF-VERIFYING, one transaction: preconditions first, postconditions last. Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-12-27_church_people_groups.sql (is_church_profile, church_is_owner, church_has_permission), is_admin().
-- Preflight (read-only, run BEFORE): supabase/support/2027-01-03_ministry_testimonies.preflight.sql
-- Verify    (read-only, run AFTER):  supabase/support/2027-01-03_ministry_testimonies.verify.sql
-- Rollback: supabase/support/2027-01-03_ministry_testimonies.rollback.sql (refuses to run while any row exists unless data loss is explicitly confirmed).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS + a snapshot of the objects this file must leave untouched
-- ----------------------------------------------------------------------------
do $$
declare
  v_marker constant text := 'managed by 2027-01-03_ministry_testimonies.sql';
  v_missing text;
  v_bad text;
  v_have int := (select count(*) from unnest(array['ministry_testimonies', 'ministry_testimony_history']) t where to_regclass('public.' || t) is not null);
begin
  select string_agg(t, ', ') into v_missing from unnest(array['profiles', 'users']) t where to_regclass('public.' || t) is null;
  if v_missing is not null then raise exception 'precondition failed: missing tables: %', v_missing; end if;

  select string_agg(f, ', ') into v_missing
    from unnest(array['public.is_admin()', 'public.is_church_profile(uuid)', 'public.church_is_owner(uuid)', 'public.church_has_permission(uuid, text)']) f
   where to_regprocedure(f) is null;
  if v_missing is not null then raise exception 'precondition failed: missing functions (is Phase 2A applied?): %', v_missing; end if;

  select string_agg(c, ', ') into v_missing from unnest(array['published']) c
   where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = c);
  if v_missing is not null then raise exception 'precondition failed: public.profiles is missing columns: %', v_missing; end if;

  select string_agg(r, ', ') into v_missing from unnest(array['anon', 'authenticated', 'service_role']) r where not exists (select 1 from pg_roles where rolname = r);
  if v_missing is not null then raise exception 'precondition failed: missing database roles: %', v_missing; end if;

  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('is_church_profile', 'church_is_owner', 'church_has_permission')
     and coalesce(obj_description(p.oid, 'pg_proc'), '') <> 'managed by 2026-12-27_church_people_groups.sql';
  if v_bad is not null then raise exception 'precondition failed: % is not managed by the Phase 2A migration', v_bad; end if;

  if v_have not in (0, 2) then raise exception 'precondition failed: only % of the 2 testimony tables exist (half-applied state); resolve it before running this file', v_have; end if;
  if v_have = 2 then
    select string_agg(t, ', ') into v_bad from unnest(array['ministry_testimonies', 'ministry_testimony_history']) t where coalesce(obj_description(to_regclass('public.' || t), 'pg_class'), '') <> v_marker;
    if v_bad is not null then raise exception 'precondition failed: table(s) % already exist but are not managed by this migration; refusing to adopt or re-mark them', v_bad; end if;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('ministry_testimony_guard', 'ministry_testimony_audit', 'ministry_testimony_history_guard', 'ministry_testimonies_public')
     and (v_have = 0 or coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker);
  if v_bad is not null then raise exception 'precondition failed: a function with one of this file''s names already exists and is not managed by it: %', v_bad; end if;
  if v_have = 0 then
    select string_agg(c.relname, ', ') into v_bad from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'ministry\_testimon%';
    if v_bad is not null then raise exception 'precondition failed: relations named ministry_testimon* already exist: %', v_bad; end if;
  end if;

  perform set_config('ministry_testimonies.pre', jsonb_build_object(
    'profiles',     (select count(*) from public.profiles),
    'users',        (select count(*) from public.users),
    'org_roles',    (select count(*) from public.organization_roles),
    'org_members',  (select count(*) from public.organization_members),
    'policies',     (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
                       from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass)
                          or p.polrelid = to_regclass('public.church_members') or p.polrelid = to_regclass('public.church_groups') or p.polrelid = to_regclass('public.daily_words')
                          or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.ministry_announcements') or p.polrelid = to_regclass('public.ministry_attendance')
                          or p.polrelid = to_regclass('public.ministry_music_links') or p.polrelid = to_regclass('public.bible_programs') or p.polrelid = to_regclass('public.ministry_care_cases')
                          or p.polrelid = to_regclass('public.ministry_care_consents') or p.polrelid = to_regclass('public.ministry_care_beneficiaries')),
    'fn_defs',      (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
                       from pg_proc f where f.pronamespace = 'public'::regnamespace
                        and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname like 'bible\_%'
                             or (f.proname like 'ministry\_%' and f.proname not in ('ministry_testimony_guard', 'ministry_testimony_audit', 'ministry_testimony_history_guard', 'ministry_testimonies_public'))
                             or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile')))
  )::text, true);
end $$;

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.ministry_testimonies (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- a key the visitor's browser makes once per form: sending the same form twice cannot create two rows
  submission_key uuid not null,
  -- the submitter's OWN words and details: never changed after they arrive
  full_name text not null,
  phone text not null,
  group_label text,
  body text not null,
  lang text not null default 'en',
  -- CONSENT. Given only at submission (by the server route); staff can only withdraw.
  publish_consent boolean not null default false,
  name_consent boolean not null default false,
  consent_at timestamptz,
  consent_withdrawn_at timestamptz,
  -- MODERATION. Two separate states.
  review_status text not null default 'submitted',
  publication_status text not null default 'unpublished',
  -- an explicit, logged staff correction; null = the submitter's own text is what the public sees
  public_body text,
  -- internal: never public, never in a report, never in Ringo AI
  moderation_note text,
  published_at timestamptz,
  reviewed_at timestamptz,
  edited_at timestamptz,
  -- audit columns: filled by ministry_testimony_guard from auth.uid(); NOT readable or writable by any API role
  published_by uuid references public.users(id) on delete set null,
  reviewed_by uuid references public.users(id) on delete set null,
  edited_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ministry_testimonies_id_profile_key unique (id, profile_id),
  constraint ministry_testimonies_submission_key unique (profile_id, submission_key),
  constraint ministry_testimonies_name_check check (char_length(btrim(full_name)) between 2 and 120),
  constraint ministry_testimonies_phone_check check (phone ~ '^[0-9]{8,15}$'),
  constraint ministry_testimonies_group_check check (group_label is null or char_length(btrim(group_label)) between 1 and 80),
  constraint ministry_testimonies_body_check check (char_length(btrim(body)) between 10 and 3000),
  constraint ministry_testimonies_lang_check check (lang in ('en', 'fr')),
  constraint ministry_testimonies_review_check check (review_status in ('submitted', 'under_review', 'approved', 'rejected')),
  constraint ministry_testimonies_publication_check check (publication_status in ('unpublished', 'published')),
  constraint ministry_testimonies_public_body_check check (public_body is null or char_length(btrim(public_body)) between 10 and 3000),
  constraint ministry_testimonies_note_check check (moderation_note is null or char_length(moderation_note) between 1 and 500),
  -- name consent only ever exists together with publication consent
  constraint ministry_testimonies_name_consent_check check (not name_consent or publish_consent),
  -- the database repeats the rule: published only while approved AND publication consent is held
  constraint ministry_testimonies_published_check check (publication_status <> 'published' or (review_status = 'approved' and publish_consent)),
  constraint ministry_testimonies_published_at_check check ((publication_status = 'published') = (published_at is not null))
);
create index if not exists ministry_testimonies_profile_idx on public.ministry_testimonies (profile_id, created_at desc);
create index if not exists ministry_testimonies_public_idx on public.ministry_testimonies (profile_id, published_at desc) where publication_status = 'published';

-- APPEND-ONLY. Written by ministry_testimony_audit() only.
create table if not exists public.ministry_testimony_history (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  testimony_id uuid not null,
  action text not null,
  from_value text,
  to_value text,
  actor_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ministry_testimony_history_fk foreign key (testimony_id, profile_id) references public.ministry_testimonies (id, profile_id) on delete cascade,
  constraint ministry_testimony_history_action_check check (action in ('submitted', 'under_review', 'approved', 'rejected', 'published', 'unpublished', 'edited', 'note_updated', 'consent_withdrawn', 'name_consent_withdrawn'))
);
create index if not exists ministry_testimony_history_idx on public.ministry_testimony_history (testimony_id, seq desc);

comment on table public.ministry_testimonies is 'managed by 2027-01-03_ministry_testimonies.sql';
comment on table public.ministry_testimony_history is 'managed by 2027-01-03_ministry_testimonies.sql';

-- ----------------------------------------------------------------------------
-- 2. FUNCTIONS
-- ----------------------------------------------------------------------------
-- Integrity for every writer (the service role included). See the header for the rules.
create or replace function public.ministry_testimony_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if not public.is_church_profile(new.profile_id) then
      raise exception 'testimony_profile_required' using errcode = '23514', detail = 'testimonies can only be received by a profile with the Churches & Ministries category';
    end if;
    -- a new testimony is always private and unreviewed, whatever the writer sent
    new.review_status := 'submitted';
    new.publication_status := 'unpublished';
    new.public_body := null; new.moderation_note := null;
    new.published_at := null; new.published_by := null;
    new.reviewed_at := null; new.reviewed_by := null;
    new.edited_at := null; new.edited_by := null;
    new.consent_withdrawn_at := null;
    new.consent_at := case when new.publish_consent then now() else null end;
    new.created_at := now(); new.updated_at := now();
    return new;
  end if;

  -- UPDATE: the submitter's own words never change
  if new.profile_id is distinct from old.profile_id or new.submission_key is distinct from old.submission_key or new.full_name is distinct from old.full_name
     or new.phone is distinct from old.phone or new.group_label is distinct from old.group_label or new.body is distinct from old.body
     or new.lang is distinct from old.lang or new.consent_at is distinct from old.consent_at or new.created_at is distinct from old.created_at then
    raise exception 'testimony_original_immutable' using errcode = '42501', detail = 'the submitter''s words and details are never changed; use the separate public text';
  end if;
  -- consent can only be withdrawn, never granted or restored
  if (new.publish_consent and not old.publish_consent) or (new.name_consent and not old.name_consent) then
    raise exception 'testimony_consent_cannot_be_granted' using errcode = '42501', detail = 'consent is given by the submitter at submission; staff can only record a withdrawal';
  end if;
  if old.publish_consent and not new.publish_consent then
    new.name_consent := false;
    new.consent_withdrawn_at := now();
    new.publication_status := 'unpublished';
  end if;
  -- review states
  if new.review_status is distinct from old.review_status then
    if new.review_status = 'submitted' then
      raise exception 'testimony_status_invalid' using errcode = '23514', detail = 'a received testimony cannot go back to submitted';
    end if;
    new.reviewed_at := now();
    if v_uid is not null then new.reviewed_by := v_uid; end if;
  else
    new.reviewed_at := old.reviewed_at; new.reviewed_by := old.reviewed_by;
  end if;
  -- an attempt to publish something that is not approved, or whose author did not consent, is refused loudly (never silently ignored)
  if new.publication_status = 'published' and old.publication_status <> 'published' and (new.review_status <> 'approved' or not new.publish_consent) then
    raise exception 'testimony_cannot_publish' using errcode = '23514', detail = 'only an approved testimony whose submitter consented to publication can be published';
  end if;
  -- a live testimony that stops being approved comes down in the same statement
  if new.review_status <> 'approved' then new.publication_status := 'unpublished'; end if;
  -- publishing
  if new.publication_status = 'published' and old.publication_status <> 'published' then
    if v_uid is not null and not public.church_has_permission(new.profile_id, 'church.testimonies.publish') then
      raise exception 'testimony_publish_permission' using errcode = '42501', detail = 'publishing needs church.testimonies.publish';
    end if;
    new.published_at := now();
    new.published_by := coalesce(v_uid, new.published_by);
  elsif new.publication_status = 'published' then
    new.published_at := old.published_at; new.published_by := old.published_by;
  else
    new.published_at := null; new.published_by := null;
  end if;
  -- a correction of the public text is logged by who made it
  if new.public_body is distinct from old.public_body then
    new.edited_at := now();
    if v_uid is not null then new.edited_by := v_uid; end if;
  else
    new.edited_at := old.edited_at; new.edited_by := old.edited_by;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Writes the moderation history, whoever changes the row (the audit cannot be skipped).
create or replace function public.ministry_testimony_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.ministry_testimony_history (profile_id, testimony_id, action, to_value, actor_id) values (new.profile_id, new.id, 'submitted', new.review_status, v_uid);
    return null;
  end if;
  if new.review_status is distinct from old.review_status then
    insert into public.ministry_testimony_history (profile_id, testimony_id, action, from_value, to_value, actor_id) values (new.profile_id, new.id, new.review_status, old.review_status, new.review_status, v_uid);
  end if;
  if old.publish_consent and not new.publish_consent then
    insert into public.ministry_testimony_history (profile_id, testimony_id, action, from_value, to_value, actor_id) values (new.profile_id, new.id, 'consent_withdrawn', 'granted', 'withdrawn', v_uid);
  elsif old.name_consent and not new.name_consent then
    insert into public.ministry_testimony_history (profile_id, testimony_id, action, from_value, to_value, actor_id) values (new.profile_id, new.id, 'name_consent_withdrawn', 'granted', 'withdrawn', v_uid);
  end if;
  if new.publication_status is distinct from old.publication_status then
    insert into public.ministry_testimony_history (profile_id, testimony_id, action, from_value, to_value, actor_id) values (new.profile_id, new.id, new.publication_status, old.publication_status, new.publication_status, v_uid);
  end if;
  if new.public_body is distinct from old.public_body then
    insert into public.ministry_testimony_history (profile_id, testimony_id, action, actor_id) values (new.profile_id, new.id, 'edited', v_uid);
  end if;
  if new.moderation_note is distinct from old.moderation_note then
    insert into public.ministry_testimony_history (profile_id, testimony_id, action, actor_id) values (new.profile_id, new.id, 'note_updated', v_uid);
  end if;
  return null;
end;
$$;

-- The history is only ever added to.
create or replace function public.ministry_testimony_history_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'testimony_history_immutable' using errcode = '42501', detail = 'the moderation history is added to, never edited';
end;
$$;

-- The ONLY way an anonymous visitor reads testimonies. It recomputes the current state on every call: approved AND published AND publication consent held, on a published church page. It returns the
-- church's public text (the staff correction when there is one, otherwise the submitter's own words) and the name ONLY when name consent is held. Never a phone number, a group, a note or a status.
create or replace function public.ministry_testimonies_public(p_profile_id uuid)
returns table (id uuid, display_name text, body text, lang text, published_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select t.id,
         case when t.name_consent then t.full_name else null end,
         coalesce(t.public_body, t.body),
         t.lang,
         t.published_at
    from public.ministry_testimonies t
    join public.profiles p on p.id = t.profile_id
   where t.profile_id = p_profile_id
     and p.published = true
     and t.review_status = 'approved'
     and t.publication_status = 'published'
     and t.publish_consent = true
   order by t.published_at desc, t.id
   limit 12
$$;

comment on function public.ministry_testimony_guard() is 'managed by 2027-01-03_ministry_testimonies.sql';
comment on function public.ministry_testimony_audit() is 'managed by 2027-01-03_ministry_testimonies.sql';
comment on function public.ministry_testimony_history_guard() is 'managed by 2027-01-03_ministry_testimonies.sql';
comment on function public.ministry_testimonies_public(uuid) is 'managed by 2027-01-03_ministry_testimonies.sql';

revoke all on function public.ministry_testimony_guard() from public, anon, authenticated;
revoke all on function public.ministry_testimony_audit() from public, anon, authenticated;
revoke all on function public.ministry_testimony_history_guard() from public, anon, authenticated;
revoke all on function public.ministry_testimonies_public(uuid) from public;
grant execute on function public.ministry_testimonies_public(uuid) to anon, authenticated, service_role;

drop trigger if exists ministry_testimonies_guard_trg on public.ministry_testimonies;
create trigger ministry_testimonies_guard_trg before insert or update on public.ministry_testimonies for each row execute function public.ministry_testimony_guard();
comment on trigger ministry_testimonies_guard_trg on public.ministry_testimonies is 'managed by 2027-01-03_ministry_testimonies.sql';
drop trigger if exists ministry_testimonies_audit_trg on public.ministry_testimonies;
create trigger ministry_testimonies_audit_trg after insert or update on public.ministry_testimonies for each row execute function public.ministry_testimony_audit();
comment on trigger ministry_testimonies_audit_trg on public.ministry_testimonies is 'managed by 2027-01-03_ministry_testimonies.sql';
drop trigger if exists ministry_testimony_history_guard_trg on public.ministry_testimony_history;
create trigger ministry_testimony_history_guard_trg before update on public.ministry_testimony_history for each row execute function public.ministry_testimony_history_guard();
comment on trigger ministry_testimony_history_guard_trg on public.ministry_testimony_history is 'managed by 2027-01-03_ministry_testimonies.sql';

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY AND PRIVILEGES
-- ----------------------------------------------------------------------------
alter table public.ministry_testimonies enable row level security;
alter table public.ministry_testimony_history enable row level security;

revoke all on public.ministry_testimonies from public, anon, authenticated;
revoke all on public.ministry_testimony_history from public, anon, authenticated;

-- staff read: everything a moderator needs, never the audit columns or the duplicate-prevention key
grant select (id, profile_id, full_name, phone, group_label, body, lang, publish_consent, name_consent, consent_at, consent_withdrawn_at, review_status, publication_status, public_body, moderation_note,
              published_at, reviewed_at, edited_at, created_at, updated_at) on public.ministry_testimonies to authenticated;
-- staff write: only the moderation columns. The consent columns can be written, but the guard accepts only a withdrawal. There is NO insert and NO delete for any API role.
grant update (review_status, publication_status, public_body, moderation_note, publish_consent, name_consent) on public.ministry_testimonies to authenticated;
grant select (id, profile_id, testimony_id, action, from_value, to_value, created_at) on public.ministry_testimony_history to authenticated;
grant all on public.ministry_testimonies to service_role;
grant all on public.ministry_testimony_history to service_role;

drop policy if exists ministry_testimonies_staff_select on public.ministry_testimonies;
create policy ministry_testimonies_staff_select on public.ministry_testimonies for select to authenticated
  using (public.church_has_permission(profile_id, 'church.testimonies.view') or public.church_has_permission(profile_id, 'church.testimonies.manage') or public.church_has_permission(profile_id, 'church.testimonies.publish'));
drop policy if exists ministry_testimonies_staff_update on public.ministry_testimonies;
create policy ministry_testimonies_staff_update on public.ministry_testimonies for update to authenticated
  using (public.church_has_permission(profile_id, 'church.testimonies.manage') or public.church_has_permission(profile_id, 'church.testimonies.publish'))
  with check (public.church_has_permission(profile_id, 'church.testimonies.manage') or public.church_has_permission(profile_id, 'church.testimonies.publish'));
drop policy if exists ministry_testimonies_no_platform_admin_update on public.ministry_testimonies;
create policy ministry_testimonies_no_platform_admin_update on public.ministry_testimonies as restrictive for update to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id))
  with check (not public.is_admin() or public.church_is_owner(profile_id));

drop policy if exists ministry_testimony_history_staff_select on public.ministry_testimony_history;
create policy ministry_testimony_history_staff_select on public.ministry_testimony_history for select to authenticated
  using (public.church_has_permission(profile_id, 'church.testimonies.view') or public.church_has_permission(profile_id, 'church.testimonies.manage') or public.church_has_permission(profile_id, 'church.testimonies.publish'));

-- ----------------------------------------------------------------------------
-- 4. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
declare
  v_pre jsonb := current_setting('ministry_testimonies.pre')::jsonb;
  v_marker constant text := 'managed by 2027-01-03_ministry_testimonies.sql';
  v_t text;
  v_n int;
  v_bad text;
begin
  foreach v_t in array array['ministry_testimonies', 'ministry_testimony_history'] loop
    if coalesce(obj_description(to_regclass('public.' || v_t), 'pg_class'), '') <> v_marker then raise exception 'postcondition failed: table marker on %', v_t; end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || v_t)) then raise exception 'postcondition failed: row-level security is off on %', v_t; end if;
    if has_table_privilege('public', 'public.' || v_t, 'select') or has_table_privilege('public', 'public.' || v_t, 'insert') then raise exception 'postcondition failed: PUBLIC has a table privilege on %', v_t; end if;
    -- anon has NOTHING on either table: not even a column
    if has_any_column_privilege('anon', 'public.' || v_t, 'select') or has_any_column_privilege('anon', 'public.' || v_t, 'insert') or has_any_column_privilege('anon', 'public.' || v_t, 'update')
       or has_table_privilege('anon', 'public.' || v_t, 'delete') then
      raise exception 'postcondition failed: anon has a privilege on %', v_t;
    end if;
    -- nobody can insert or delete through the API; nobody can truncate, reference or trigger
    if has_any_column_privilege('authenticated', 'public.' || v_t, 'insert') or has_table_privilege('authenticated', 'public.' || v_t, 'delete')
       or has_table_privilege('authenticated', 'public.' || v_t, 'truncate') or has_table_privilege('authenticated', 'public.' || v_t, 'references') or has_table_privilege('authenticated', 'public.' || v_t, 'trigger') then
      raise exception 'postcondition failed: authenticated can insert, delete, truncate, reference or trigger %', v_t;
    end if;
    select count(*) into v_n from pg_policy where polrelid = to_regclass('public.' || v_t) and polroles = array[0::oid];
    if v_n <> 0 then raise exception 'postcondition failed: a policy of % applies to PUBLIC', v_t; end if;
  end loop;
  select string_agg(r || '.' || cols.column_name || '.' || k, ', ') into v_bad
    from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update']) k,
         (select table_name, column_name from information_schema.columns where table_schema = 'public'
             and ((table_name = 'ministry_testimonies' and column_name in ('published_by', 'reviewed_by', 'edited_by', 'submission_key')) or (table_name = 'ministry_testimony_history' and column_name = 'actor_id'))) cols
   where has_column_privilege(r, 'public.' || cols.table_name, cols.column_name, k);
  if v_bad is not null then raise exception 'postcondition failed: audit column reachable: %', v_bad; end if;
  -- the submitter's own words can never be written by an API role
  select string_agg(c, ', ') into v_bad from unnest(array['full_name', 'phone', 'group_label', 'body', 'lang', 'profile_id']) c where has_column_privilege('authenticated', 'public.ministry_testimonies', c, 'update');
  if v_bad is not null then raise exception 'postcondition failed: the submitter''s words are updatable: %', v_bad; end if;
  if (select count(*) filter (where polpermissive) from pg_policy where polrelid = 'public.ministry_testimonies'::regclass) <> 2
     or (select count(*) filter (where not polpermissive) from pg_policy where polrelid = 'public.ministry_testimonies'::regclass) <> 1 then raise exception 'postcondition failed: policies on ministry_testimonies'; end if;
  if (select count(*) from pg_policy where polrelid = 'public.ministry_testimony_history'::regclass) <> 1 then raise exception 'postcondition failed: policies on ministry_testimony_history'; end if;
  if has_any_column_privilege('authenticated', 'public.ministry_testimony_history', 'update') then raise exception 'postcondition failed: the history can be updated'; end if;

  select count(*) into v_n from pg_trigger where not tgisinternal and tgname in ('ministry_testimonies_guard_trg', 'ministry_testimonies_audit_trg', 'ministry_testimony_history_guard_trg');
  if v_n <> 3 then raise exception 'postcondition failed: expected 3 triggers, found %', v_n; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('ministry_testimony_guard', 'ministry_testimony_audit', 'ministry_testimony_history_guard')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'));
  if v_bad is not null then raise exception 'postcondition failed: a guard function is callable by an API role: %', v_bad; end if;
  if not (has_function_privilege('anon', 'public.ministry_testimonies_public(uuid)', 'execute') and has_function_privilege('authenticated', 'public.ministry_testimonies_public(uuid)', 'execute'))
     or has_function_privilege('public', 'public.ministry_testimonies_public(uuid)', 'execute') then
    raise exception 'postcondition failed: the public function privileges';
  end if;

  -- no money, anywhere
  select string_agg(c.table_name || '.' || c.column_name, ', ') into v_bad from information_schema.columns c
   where c.table_schema = 'public' and c.table_name like 'ministry\_testimon%' and c.column_name ~* '(amount|price|currency|money|fee|commission|payment|payout|refund|receipt|balance)';
  if v_bad is not null then raise exception 'postcondition failed: a money-like column exists: %', v_bad; end if;

  -- nothing existing changed
  if (select count(*) from public.profiles) <> (v_pre->>'profiles')::bigint or (select count(*) from public.users) <> (v_pre->>'users')::bigint
     or (select count(*) from public.organization_roles) <> (v_pre->>'org_roles')::bigint or (select count(*) from public.organization_members) <> (v_pre->>'org_members')::bigint then
    raise exception 'postcondition failed: a row count of an existing table changed';
  end if;
  if (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
        from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass)
                           or p.polrelid = to_regclass('public.church_members') or p.polrelid = to_regclass('public.church_groups') or p.polrelid = to_regclass('public.daily_words')
                           or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.ministry_announcements') or p.polrelid = to_regclass('public.ministry_attendance')
                           or p.polrelid = to_regclass('public.ministry_music_links') or p.polrelid = to_regclass('public.bible_programs') or p.polrelid = to_regclass('public.ministry_care_cases')
                           or p.polrelid = to_regclass('public.ministry_care_consents') or p.polrelid = to_regclass('public.ministry_care_beneficiaries')) is distinct from v_pre->'policies' then
    raise exception 'postcondition failed: a policy of an existing table changed';
  end if;
  if (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
        from pg_proc f where f.pronamespace = 'public'::regnamespace
         and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname like 'bible\_%'
              or (f.proname like 'ministry\_%' and f.proname not in ('ministry_testimony_guard', 'ministry_testimony_audit', 'ministry_testimony_history_guard', 'ministry_testimonies_public'))
              or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile'))) is distinct from v_pre->'fn_defs' then
    raise exception 'postcondition failed: an existing function changed';
  end if;
end $$;

commit;
