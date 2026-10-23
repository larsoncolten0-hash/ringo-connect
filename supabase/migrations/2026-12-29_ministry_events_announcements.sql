-- Churches & Ministries Phase 4: Events & Announcements (database foundation) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Adds TWO tables, public.ministry_events and public.ministry_announcements, one shared guard trigger function and one date helper. Nothing existing is changed: no table, column, constraint,
-- policy, trigger or function of Phase 0, Phase 2A, Phase 3, Team, ticketing or anything else is altered, and no row is read or written. It CALLS (never modifies) the Phase 2A helpers
-- is_church_profile(), church_is_owner() and church_has_permission(), and the platform's is_admin().
--
--   NEW  public.ministry_events         one gathering of a church (service, meeting, outreach), in English and/or French, with a date, optional times and place
--   NEW  public.ministry_announcements  one notice of a church (a short message), in English and/or French, with an optional last day
--   NEW  functions ministry_today(), ministry_content_guard()
--
-- WHY NEW TABLES (and not the existing public.events): public.events is the music ticketing table. Its RLS lets only the profile OWNER write (no church team permissions), it is readable by everyone
-- (a draft is only hidden by the application), it has no English/French columns, and ticket sales, QR check-in and payments hang off it. Reusing it would mean changing its policies, which this project
-- forbids; and an announcement is a displayed notice, not the e-mail/WhatsApp send of public.community_announcements. Attendance (Phase 7) attaches to ministry_events, so there is ONE church event model.
--
-- NAMING: no church_ prefix on purpose. The Phase 0 verify script (2026-12-26_church_category.verify.sql, row 10) expects no church_* table other than the four Phase 2A ones.
--
-- PERMISSIONS (strings stored in organization_roles.permissions like every other permission; church_has_permission() already answers for any string)
--   church.events.view      see every event and announcement of the church, drafts included
--   church.events.manage    create, edit and delete DRAFTS
--   church.events.publish   publish, unpublish, and edit or delete a LIVE entry
--   The owner of a church implicitly holds all three. The Phase 2A grant guards treat every church.* string they do not list as SENSITIVE (OWNER-ONLY to grant), so no Phase 2A object changes.
--
-- LIFECYCLE: status is 'draft' or 'published'. An event may be cancelled (is_cancelled) while it stays published, so visitors see that it is cancelled. An announcement may carry a last day
-- (expires_on, Africa/Douala calendar): after it the public policy no longer returns it. There is no job or cron.
--
-- ROW-LEVEL SECURITY (identical shape for both tables, as for public.daily_words)
--   * staff read:     church.events.view, .manage or .publish (church_has_permission: owner, or an ACTIVE member whose role holds the string; never a platform admin who is not the owner)
--   * public read:    anon and authenticated, only status = 'published' rows of a published profile (announcements: also not past their last day). Drafts are never public.
--   * insert/update/delete: church.events.publish, or church.events.manage while the row is (and stays) a draft. So manage alone can never publish, unpublish or touch a live entry.
--   * RESTRICTIVE policies on insert / update / delete refuse a platform admin who is not the church's owner.
--   * there is no policy for PUBLIC; every table privilege is revoked from it.
--
-- COLUMN GRANTS: anon and authenticated read and write only the content columns. The audit columns (created_by, updated_by, published_by) are readable and writable by NO API role.
--
-- SELF-VERIFYING, one transaction: preconditions first, postconditions last (structure, row-level security, privileges, policies, triggers, and proof that Phase 2A / Team / Phase 3 objects are unchanged).
-- Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-12-27_church_people_groups.sql (is_church_profile, church_is_owner, church_has_permission), is_admin().
-- Preflight (read-only, run BEFORE): supabase/support/2026-12-29_ministry_events_announcements.preflight.sql
-- Verify    (read-only, run AFTER):  supabase/support/2026-12-29_ministry_events_announcements.verify.sql
-- Rollback: supabase/support/2026-12-29_ministry_events_announcements.rollback.sql (refuses to run while any row exists unless data loss is explicitly confirmed).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS + a snapshot of the objects this file must leave untouched
-- ----------------------------------------------------------------------------
do $$
declare
  v_marker constant text := 'managed by 2026-12-29_ministry_events_announcements.sql';
  v_missing text;
  v_bad text;
  v_have int := (select count(*) from unnest(array['ministry_events', 'ministry_announcements']) t where to_regclass('public.' || t) is not null);
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

  -- the Phase 2A policy helpers must be the real ones (the marker proves they were created by that migration)
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('is_church_profile', 'church_is_owner', 'church_has_permission')
     and coalesce(obj_description(p.oid, 'pg_proc'), '') <> 'managed by 2026-12-27_church_people_groups.sql';
  if v_bad is not null then raise exception 'precondition failed: % is not managed by the Phase 2A migration', v_bad; end if;

  -- half-applied guard: either neither table exists (first run) or both do (re-run)
  if v_have not in (0, 2) then raise exception 'precondition failed: only % of the 2 ministry tables exist (half-applied state); resolve it before running this file', v_have; end if;
  if v_have = 2 then
    select string_agg(t, ', ') into v_bad from unnest(array['ministry_events', 'ministry_announcements']) t where coalesce(obj_description(to_regclass('public.' || t), 'pg_class'), '') <> v_marker;
    if v_bad is not null then raise exception 'precondition failed: table(s) % already exist but are not managed by this migration; refusing to adopt or re-mark them', v_bad; end if;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('ministry_today', 'ministry_content_guard')
     and (v_have = 0 or coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker);
  if v_bad is not null then raise exception 'precondition failed: a function with one of this file''s names already exists and is not managed by it: %', v_bad; end if;
  if v_have = 0 then
    select string_agg(c.relname, ', ') into v_bad from pg_class c
     where c.relnamespace = 'public'::regnamespace and (c.relname like 'ministry\_event%' or c.relname like 'ministry\_announcement%');
    if v_bad is not null then raise exception 'precondition failed: relations named ministry_event* / ministry_announcement* already exist: %', v_bad; end if;
  end if;

  perform set_config('ministry_events.pre', jsonb_build_object(
    'profiles',     (select count(*) from public.profiles),
    'users',        (select count(*) from public.users),
    'org_roles',    (select count(*) from public.organization_roles),
    'org_members',  (select count(*) from public.organization_members),
    'policies',     (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
                       from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass,
                                                              'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass)
                          or p.polrelid = to_regclass('public.daily_words')),
    'fn_defs',      (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
                       from pg_proc f where f.pronamespace = 'public'::regnamespace
                        and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile')))
  )::text, true);
end $$;

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.ministry_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'draft',
  event_date date not null,
  start_time time,
  end_time time,
  title_en text,
  title_fr text,
  description_en text,
  description_fr text,
  venue text,
  address text,
  online_url text,
  is_cancelled boolean not null default false,
  published_at timestamptz,
  -- audit columns: filled by ministry_content_guard from auth.uid(); NOT readable or writable by any API role (see the column grants)
  published_by uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- target of the composite foreign keys of the attendance table (Phase 7): attendance can only ever point at an event of the SAME church
  constraint ministry_events_id_profile_key unique (id, profile_id),
  constraint ministry_events_status_check check (status in ('draft', 'published')),
  constraint ministry_events_date_check check (event_date between date '2020-01-01' and date '2100-12-31'),
  constraint ministry_events_times_check check (start_time is null or end_time is null or end_time > start_time),
  constraint ministry_events_published_at_check check ((status = 'published') = (published_at is not null)),
  constraint ministry_events_title_en_check check (title_en is null or char_length(title_en) between 1 and 120),
  constraint ministry_events_title_fr_check check (title_fr is null or char_length(title_fr) between 1 and 120),
  constraint ministry_events_description_en_check check (description_en is null or char_length(description_en) between 1 and 2000),
  constraint ministry_events_description_fr_check check (description_fr is null or char_length(description_fr) between 1 and 2000),
  constraint ministry_events_venue_check check (venue is null or char_length(venue) between 1 and 160),
  constraint ministry_events_address_check check (address is null or char_length(address) between 1 and 240),
  -- a link to an online service: https only, a real host, no credentials in it, no spaces
  constraint ministry_events_online_url_check check (online_url is null or (char_length(online_url) between 12 and 500 and online_url ~ '^https://[^\s/@?#]+\.[^\s/@?#]+([/?#]\S*)?$')),
  -- a published event is readable in at least one language: it needs a title in English or in French
  constraint ministry_events_publish_content_check check (status <> 'published' or nullif(btrim(title_en), '') is not null or nullif(btrim(title_fr), '') is not null)
);
create index if not exists ministry_events_profile_date_idx on public.ministry_events (profile_id, event_date desc);

create table if not exists public.ministry_announcements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'draft',
  title_en text,
  title_fr text,
  body_en text,
  body_fr text,
  -- the last day the notice is shown (Africa/Douala calendar); null = until it is unpublished
  expires_on date,
  published_at timestamptz,
  published_by uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ministry_announcements_status_check check (status in ('draft', 'published')),
  constraint ministry_announcements_expires_check check (expires_on is null or expires_on between date '2020-01-01' and date '2100-12-31'),
  constraint ministry_announcements_published_at_check check ((status = 'published') = (published_at is not null)),
  constraint ministry_announcements_title_en_check check (title_en is null or char_length(title_en) between 1 and 120),
  constraint ministry_announcements_title_fr_check check (title_fr is null or char_length(title_fr) between 1 and 120),
  constraint ministry_announcements_body_en_check check (body_en is null or char_length(body_en) between 1 and 2000),
  constraint ministry_announcements_body_fr_check check (body_fr is null or char_length(body_fr) between 1 and 2000),
  -- a published notice is readable in at least one language: a title AND a body in English, or a title AND a body in French
  constraint ministry_announcements_publish_content_check check (
    status <> 'published'
    or (nullif(btrim(title_en), '') is not null and nullif(btrim(body_en), '') is not null)
    or (nullif(btrim(title_fr), '') is not null and nullif(btrim(body_fr), '') is not null)
  )
);
create index if not exists ministry_announcements_profile_idx on public.ministry_announcements (profile_id, created_at desc);

comment on table public.ministry_events is 'managed by 2026-12-29_ministry_events_announcements.sql';
comment on table public.ministry_announcements is 'managed by 2026-12-29_ministry_events_announcements.sql';

-- ----------------------------------------------------------------------------
-- 2. FUNCTIONS
-- ----------------------------------------------------------------------------
-- Today's calendar date in Africa/Douala (UTC+1, no daylight saving). Plain arithmetic on UTC, so it does not depend on the time-zone database.
create or replace function public.ministry_today()
returns date
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select ((now() at time zone 'utc') + interval '1 hour')::date
$$;

-- Integrity and bookkeeping for every writer (the service role included) of BOTH tables: the church can never change, rows are only created for a church profile, the audit columns come from the
-- authenticated caller (a value supplied by a client is overwritten), and published_at / published_by follow the status.
create or replace function public.ministry_content_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_church_profile(new.profile_id) then
      raise exception 'ministry_profile_required' using errcode = '23514', detail = 'entries can only be created for a profile with the Churches & Ministries category';
    end if;
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.updated_by := auth.uid();
    end if;
  else
    if new.profile_id is distinct from old.profile_id then
      raise exception 'ministry_tenant_immutable' using errcode = '42501', detail = 'an entry can never be moved to another church';
    end if;
    if auth.uid() is not null then
      new.created_by := old.created_by;
      new.updated_by := auth.uid();
    end if;
    new.updated_at := now();
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

comment on function public.ministry_today() is 'managed by 2026-12-29_ministry_events_announcements.sql';
comment on function public.ministry_content_guard() is 'managed by 2026-12-29_ministry_events_announcements.sql';

drop trigger if exists ministry_events_guard_trg on public.ministry_events;
create trigger ministry_events_guard_trg before insert or update on public.ministry_events for each row execute function public.ministry_content_guard();
comment on trigger ministry_events_guard_trg on public.ministry_events is 'managed by 2026-12-29_ministry_events_announcements.sql';
drop trigger if exists ministry_announcements_guard_trg on public.ministry_announcements;
create trigger ministry_announcements_guard_trg before insert or update on public.ministry_announcements for each row execute function public.ministry_content_guard();
comment on trigger ministry_announcements_guard_trg on public.ministry_announcements is 'managed by 2026-12-29_ministry_events_announcements.sql';

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY AND PRIVILEGES
-- ----------------------------------------------------------------------------
alter table public.ministry_events enable row level security;
alter table public.ministry_announcements enable row level security;

revoke all on public.ministry_events from public, anon, authenticated;
revoke all on public.ministry_announcements from public, anon, authenticated;
-- READ: only the content columns (never the audit columns), for anon and signed-in users alike; the policies decide which ROWS.
grant select (id, profile_id, status, event_date, start_time, end_time, title_en, title_fr, description_en, description_fr, venue, address, online_url, is_cancelled, published_at, created_at, updated_at) on public.ministry_events to anon, authenticated;
grant select (id, profile_id, status, title_en, title_fr, body_en, body_fr, expires_on, published_at, created_at, updated_at) on public.ministry_announcements to anon, authenticated;
-- WRITE (signed-in users only): content columns and the status; profile_id only on insert. No TRUNCATE / REFERENCES / TRIGGER.
grant insert (id, profile_id, event_date, start_time, end_time, status, title_en, title_fr, description_en, description_fr, venue, address, online_url, is_cancelled) on public.ministry_events to authenticated;
grant update (event_date, start_time, end_time, status, title_en, title_fr, description_en, description_fr, venue, address, online_url, is_cancelled) on public.ministry_events to authenticated;
grant delete on public.ministry_events to authenticated;
grant insert (id, profile_id, status, title_en, title_fr, body_en, body_fr, expires_on) on public.ministry_announcements to authenticated;
grant update (status, title_en, title_fr, body_en, body_fr, expires_on) on public.ministry_announcements to authenticated;
grant delete on public.ministry_announcements to authenticated;
grant all on public.ministry_events to service_role;
grant all on public.ministry_announcements to service_role;

-- ministry_events
drop policy if exists ministry_events_staff_select on public.ministry_events;
create policy ministry_events_staff_select on public.ministry_events for select to authenticated
  using (public.church_has_permission(profile_id, 'church.events.view') or public.church_has_permission(profile_id, 'church.events.manage') or public.church_has_permission(profile_id, 'church.events.publish'));

drop policy if exists ministry_events_public_select on public.ministry_events;
create policy ministry_events_public_select on public.ministry_events for select to anon, authenticated
  using (status = 'published' and exists (select 1 from public.profiles p where p.id = profile_id and p.published = true));

-- publish permission: anything. manage permission: drafts only, and the row must still be a draft afterwards (so manage alone can never publish).
drop policy if exists ministry_events_insert on public.ministry_events;
create policy ministry_events_insert on public.ministry_events for insert to authenticated
  with check (public.church_has_permission(profile_id, 'church.events.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.events.manage')));
drop policy if exists ministry_events_update on public.ministry_events;
create policy ministry_events_update on public.ministry_events for update to authenticated
  using (public.church_has_permission(profile_id, 'church.events.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.events.manage')))
  with check (public.church_has_permission(profile_id, 'church.events.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.events.manage')));
drop policy if exists ministry_events_delete on public.ministry_events;
create policy ministry_events_delete on public.ministry_events for delete to authenticated
  using (public.church_has_permission(profile_id, 'church.events.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.events.manage')));

drop policy if exists ministry_events_no_platform_admin_insert on public.ministry_events;
create policy ministry_events_no_platform_admin_insert on public.ministry_events as restrictive for insert to authenticated
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists ministry_events_no_platform_admin_update on public.ministry_events;
create policy ministry_events_no_platform_admin_update on public.ministry_events as restrictive for update to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id))
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists ministry_events_no_platform_admin_delete on public.ministry_events;
create policy ministry_events_no_platform_admin_delete on public.ministry_events as restrictive for delete to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id));

-- ministry_announcements
drop policy if exists ministry_announcements_staff_select on public.ministry_announcements;
create policy ministry_announcements_staff_select on public.ministry_announcements for select to authenticated
  using (public.church_has_permission(profile_id, 'church.events.view') or public.church_has_permission(profile_id, 'church.events.manage') or public.church_has_permission(profile_id, 'church.events.publish'));

drop policy if exists ministry_announcements_public_select on public.ministry_announcements;
create policy ministry_announcements_public_select on public.ministry_announcements for select to anon, authenticated
  using (status = 'published' and (expires_on is null or expires_on >= public.ministry_today()) and exists (select 1 from public.profiles p where p.id = profile_id and p.published = true));

-- publish permission: anything. manage permission: drafts only, and the row must still be a draft afterwards (so manage alone can never publish).
drop policy if exists ministry_announcements_insert on public.ministry_announcements;
create policy ministry_announcements_insert on public.ministry_announcements for insert to authenticated
  with check (public.church_has_permission(profile_id, 'church.events.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.events.manage')));
drop policy if exists ministry_announcements_update on public.ministry_announcements;
create policy ministry_announcements_update on public.ministry_announcements for update to authenticated
  using (public.church_has_permission(profile_id, 'church.events.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.events.manage')))
  with check (public.church_has_permission(profile_id, 'church.events.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.events.manage')));
drop policy if exists ministry_announcements_delete on public.ministry_announcements;
create policy ministry_announcements_delete on public.ministry_announcements for delete to authenticated
  using (public.church_has_permission(profile_id, 'church.events.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.events.manage')));

drop policy if exists ministry_announcements_no_platform_admin_insert on public.ministry_announcements;
create policy ministry_announcements_no_platform_admin_insert on public.ministry_announcements as restrictive for insert to authenticated
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists ministry_announcements_no_platform_admin_update on public.ministry_announcements;
create policy ministry_announcements_no_platform_admin_update on public.ministry_announcements as restrictive for update to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id))
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists ministry_announcements_no_platform_admin_delete on public.ministry_announcements;
create policy ministry_announcements_no_platform_admin_delete on public.ministry_announcements as restrictive for delete to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id));

-- ----------------------------------------------------------------------------
-- 4. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
declare
  v_pre jsonb := current_setting('ministry_events.pre')::jsonb;
  v_marker constant text := 'managed by 2026-12-29_ministry_events_announcements.sql';
  v_t text;
  v_n int;
  v_bad text;
begin
  foreach v_t in array array['ministry_events', 'ministry_announcements'] loop
    if coalesce(obj_description(to_regclass('public.' || v_t), 'pg_class'), '') <> v_marker then raise exception 'postcondition failed: table marker on %', v_t; end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || v_t)) then raise exception 'postcondition failed: row-level security is off on %', v_t; end if;

    -- privileges: PUBLIC and anon have nothing but column SELECT; no API role has TRUNCATE / REFERENCES / TRIGGER; the audit columns are out of reach
    if has_table_privilege('public', 'public.' || v_t, 'select') or has_table_privilege('public', 'public.' || v_t, 'insert') then raise exception 'postcondition failed: PUBLIC has a table privilege on %', v_t; end if;
    if has_table_privilege('anon', 'public.' || v_t, 'select') or has_table_privilege('anon', 'public.' || v_t, 'insert') or has_table_privilege('anon', 'public.' || v_t, 'update') or has_table_privilege('anon', 'public.' || v_t, 'delete') then
      raise exception 'postcondition failed: anon has a TABLE-level privilege on % (it must have column SELECT only)', v_t;
    end if;
    if has_table_privilege('authenticated', 'public.' || v_t, 'truncate') or has_table_privilege('authenticated', 'public.' || v_t, 'references') or has_table_privilege('authenticated', 'public.' || v_t, 'trigger') then
      raise exception 'postcondition failed: authenticated can truncate, reference or trigger %', v_t;
    end if;
    select string_agg(r || '.' || c || '.' || k, ', ') into v_bad
      from unnest(array['anon', 'authenticated']) r, unnest(array['created_by', 'updated_by', 'published_by']) c, unnest(array['select', 'insert', 'update']) k
     where has_column_privilege(r, 'public.' || v_t, c, k);
    if v_bad is not null then raise exception 'postcondition failed: audit column reachable on %: %', v_t, v_bad; end if;
    if has_column_privilege('anon', 'public.' || v_t, 'title_en', 'insert') or has_column_privilege('anon', 'public.' || v_t, 'title_en', 'update') then raise exception 'postcondition failed: anon can write %', v_t; end if;
    if not has_column_privilege('anon', 'public.' || v_t, 'title_en', 'select') then raise exception 'postcondition failed: anon cannot read the public columns of %', v_t; end if;
    if has_column_privilege('authenticated', 'public.' || v_t, 'profile_id', 'update') then raise exception 'postcondition failed: profile_id is updatable on %', v_t; end if;

    -- policies: 3 permissive writes + 2 permissive reads + 3 restrictive, none for PUBLIC
    select count(*) into v_n from pg_policy where polrelid = to_regclass('public.' || v_t) and polpermissive;
    if v_n <> 5 then raise exception 'postcondition failed: expected 5 permissive policies on %, found %', v_t, v_n; end if;
    select count(*) into v_n from pg_policy where polrelid = to_regclass('public.' || v_t) and not polpermissive;
    if v_n <> 3 then raise exception 'postcondition failed: expected 3 restrictive policies on %, found %', v_t, v_n; end if;
    select count(*) into v_n from pg_policy where polrelid = to_regclass('public.' || v_t) and polroles = array[0::oid];
    if v_n <> 0 then raise exception 'postcondition failed: a policy of % applies to PUBLIC', v_t; end if;

    select count(*) into v_n from pg_trigger where tgrelid = to_regclass('public.' || v_t) and not tgisinternal and tgname = v_t || '_guard_trg';
    if v_n <> 1 then raise exception 'postcondition failed: guard trigger on %', v_t; end if;
  end loop;

  -- nothing existing changed
  if (select count(*) from public.profiles) <> (v_pre->>'profiles')::bigint or (select count(*) from public.users) <> (v_pre->>'users')::bigint
     or (select count(*) from public.organization_roles) <> (v_pre->>'org_roles')::bigint or (select count(*) from public.organization_members) <> (v_pre->>'org_members')::bigint then
    raise exception 'postcondition failed: a row count of an existing table changed';
  end if;
  if (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
        from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass,
                                               'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass)
                           or p.polrelid = to_regclass('public.daily_words')) is distinct from v_pre->'policies' then
    raise exception 'postcondition failed: a policy of an existing table changed';
  end if;
  if (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
        from pg_proc f where f.pronamespace = 'public'::regnamespace
         and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile'))) is distinct from v_pre->'fn_defs' then
    raise exception 'postcondition failed: an existing function changed';
  end if;
end $$;

commit;
