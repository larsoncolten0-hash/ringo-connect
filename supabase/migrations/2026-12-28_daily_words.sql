-- Churches & Ministries Phase 3: Content Studio and Daily Word (database foundation) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Adds ONE table, public.daily_words, its guard functions and policies. Nothing existing is changed: no table, column, constraint, policy, trigger or function of Phase 0,
-- Phase 2A, Team or anything else is altered, and no row is read or written. It CALLS (never modifies) the Phase 2A helpers is_church_profile(), church_is_owner() and
-- church_has_permission(), and the platform's is_admin().
--
--   NEW  public.daily_words      one devotional entry of a church, in English and/or French, with a publication date
--   NEW  functions daily_word_today(), daily_word_guard()
--
-- WHAT THIS DOES NOT DO: no image or file storage (text only), no notification or announcement, no AI, no plan or pricing change, no change to profiles.
--
-- NAMING: the table has no church_ prefix on purpose. The Phase 0 verify script (2026-12-26_church_category.verify.sql, row 10) expects no church_* table other than the four Phase 2A ones.
--
-- PERMISSIONS (strings stored in organization_roles.permissions like every other permission; church_has_permission() already answers for any string)
--   church.content.view     see every entry of the church, drafts and scheduled ones included
--   church.content.manage   create, edit and delete DRAFTS
--   church.content.publish  publish, schedule, unpublish, and edit or delete a LIVE entry
--   The owner of a church implicitly holds all three. The Phase 2A grant guards (team_church_permission_tier) treat every church.* string they do not list as SENSITIVE, i.e. OWNER-ONLY to grant,
--   so these three need no change to any Phase 2A object: only the church owner can give them to someone (proved by the adversarial test, which uses the real Team triggers).
--
-- LIFECYCLE: status is 'draft' or 'published'. "Scheduled" is DERIVED: a published entry whose publish_on is still in the future. There is no job or cron: the public read policy only returns a
-- published entry once its date has arrived, on the Africa/Douala calendar (UTC+1, no daylight saving; daily_word_today()). At most ONE published entry per church per date (partial unique index);
-- drafts are unlimited.
--
-- ROW-LEVEL SECURITY
--   * staff read:     church.content.view, .manage or .publish (church_has_permission: owner, or an ACTIVE member whose role holds the string; never a platform admin who is not the owner)
--   * public read:    anon and authenticated, only rows with status = 'published' AND publish_on <= daily_word_today(), of a published profile. Drafts and future-dated entries are never public.
--   * insert/update/delete: church.content.publish, or church.content.manage while the row is (and stays) a draft. So manage alone can never publish, unpublish or touch a live entry.
--   * RESTRICTIVE policies on insert / update / delete refuse a platform admin who is not the church's owner. (Select is deliberately not restricted that way, so an admin browsing a public page
--     sees the public words like everyone else; the staff read policy still never lets an admin read drafts.)
--   * there is no policy for PUBLIC; every table privilege is revoked from it.
--
-- COLUMN GRANTS: anon and authenticated can read and write only the content columns. The audit columns (created_by, updated_by, published_by) are readable and writable by NO API role, so a
-- public or signed-in visitor can never learn which account wrote an entry; the guard trigger fills them in from auth.uid().
--
-- SELF-VERIFYING, one transaction: preconditions first (every dependency exists, no half-applied state, no name collision), postconditions last (structure, row-level security, privileges,
-- policies, triggers, and proof that the Phase 2A and Team objects are unchanged). Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-12-27_church_people_groups.sql (is_church_profile, church_is_owner, church_has_permission), 2026-10-01_team_management.sql, is_admin().
-- Preflight (read-only, run BEFORE): supabase/support/2026-12-28_daily_words.preflight.sql
-- Verify    (read-only, run AFTER):  supabase/support/2026-12-28_daily_words.verify.sql
-- Rollback: supabase/support/2026-12-28_daily_words.rollback.sql (refuses to run while any entry exists unless data loss is explicitly confirmed).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS + a snapshot of the objects this file must leave untouched
-- ----------------------------------------------------------------------------
do $$
declare
  v_marker constant text := 'managed by 2026-12-28_daily_words.sql';
  v_missing text;
  v_bad text;
  v_have boolean := to_regclass('public.daily_words') is not null;
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

  -- name collisions: on a first run nothing of ours may exist; on a re-run everything must carry our marker
  if v_have and coalesce(obj_description(to_regclass('public.daily_words'), 'pg_class'), '') <> v_marker then
    raise exception 'precondition failed: public.daily_words already exists and is not managed by this migration; refusing to adopt or re-mark it';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('daily_word_today', 'daily_word_guard')
     and (not v_have or coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker);
  if v_bad is not null then raise exception 'precondition failed: a function with one of this file''s names already exists and is not managed by it: %', v_bad; end if;
  if not v_have then
    select string_agg(c.relname, ', ') into v_bad from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'daily\_word%';
    if v_bad is not null then raise exception 'precondition failed: relations named daily_word* already exist: %', v_bad; end if;
  end if;

  perform set_config('daily_words.pre', jsonb_build_object(
    'profiles',     (select count(*) from public.profiles),
    'users',        (select count(*) from public.users),
    'org_roles',    (select count(*) from public.organization_roles),
    'org_members',  (select count(*) from public.organization_members),
    'policies',     (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
                       from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass,
                                                              'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass)),
    'fn_defs',      (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
                       from pg_proc f where f.pronamespace = 'public'::regnamespace
                        and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile')))
  )::text, true);
end $$;

-- ----------------------------------------------------------------------------
-- 1. TABLE
-- ----------------------------------------------------------------------------
create table if not exists public.daily_words (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  publish_on date not null,
  status text not null default 'draft',
  title_en text,
  title_fr text,
  scripture_ref_en text,
  scripture_ref_fr text,
  scripture_text_en text,
  scripture_text_fr text,
  body_en text,
  body_fr text,
  prayer_en text,
  prayer_fr text,
  published_at timestamptz,
  -- audit columns: filled by daily_word_guard from auth.uid(); NOT readable or writable by any API role (see the column grants)
  published_by uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_words_status_check check (status in ('draft', 'published')),
  constraint daily_words_publish_on_check check (publish_on between date '2020-01-01' and date '2100-12-31'),
  constraint daily_words_published_at_check check ((status = 'published') = (published_at is not null)),
  constraint daily_words_title_en_check check (title_en is null or char_length(title_en) between 1 and 120),
  constraint daily_words_title_fr_check check (title_fr is null or char_length(title_fr) between 1 and 120),
  constraint daily_words_ref_en_check check (scripture_ref_en is null or char_length(scripture_ref_en) between 1 and 120),
  constraint daily_words_ref_fr_check check (scripture_ref_fr is null or char_length(scripture_ref_fr) between 1 and 120),
  constraint daily_words_scripture_en_check check (scripture_text_en is null or char_length(scripture_text_en) between 1 and 1000),
  constraint daily_words_scripture_fr_check check (scripture_text_fr is null or char_length(scripture_text_fr) between 1 and 1000),
  constraint daily_words_body_en_check check (body_en is null or char_length(body_en) between 1 and 4000),
  constraint daily_words_body_fr_check check (body_fr is null or char_length(body_fr) between 1 and 4000),
  constraint daily_words_prayer_en_check check (prayer_en is null or char_length(prayer_en) between 1 and 1000),
  constraint daily_words_prayer_fr_check check (prayer_fr is null or char_length(prayer_fr) between 1 and 1000),
  -- a published entry must be readable in at least one language: a title AND a body in English, or a title AND a body in French
  constraint daily_words_publish_content_check check (
    status <> 'published'
    or (nullif(btrim(title_en), '') is not null and nullif(btrim(body_en), '') is not null)
    or (nullif(btrim(title_fr), '') is not null and nullif(btrim(body_fr), '') is not null)
  )
);
create index if not exists daily_words_profile_date_idx on public.daily_words (profile_id, publish_on desc);
-- at most one PUBLISHED entry per church per date (drafts are unlimited)
create unique index if not exists daily_words_one_published_per_day_key on public.daily_words (profile_id, publish_on) where status = 'published';

comment on table public.daily_words is 'managed by 2026-12-28_daily_words.sql';

-- ----------------------------------------------------------------------------
-- 2. FUNCTIONS
-- ----------------------------------------------------------------------------
-- Today's calendar date in Africa/Douala (UTC+1, no daylight saving). Plain arithmetic on UTC, so it does not depend on the time-zone database.
create or replace function public.daily_word_today()
returns date
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select ((now() at time zone 'utc') + interval '1 hour')::date
$$;

-- Integrity and bookkeeping for every writer (the service role included): the church can never change, rows are only created for a church profile, the audit columns come from the
-- authenticated caller (a value supplied by a client is overwritten), and published_at / published_by follow the status.
create or replace function public.daily_word_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_church_profile(new.profile_id) then
      raise exception 'daily_word_profile_required' using errcode = '23514', detail = 'entries can only be created for a profile with the Churches & Ministries category';
    end if;
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.updated_by := auth.uid();
    end if;
  else
    if new.profile_id is distinct from old.profile_id then
      raise exception 'daily_word_tenant_immutable' using errcode = '42501', detail = 'an entry can never be moved to another church';
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

comment on function public.daily_word_today() is 'managed by 2026-12-28_daily_words.sql';
comment on function public.daily_word_guard() is 'managed by 2026-12-28_daily_words.sql';

drop trigger if exists daily_word_guard_trg on public.daily_words;
create trigger daily_word_guard_trg before insert or update on public.daily_words for each row execute function public.daily_word_guard();
comment on trigger daily_word_guard_trg on public.daily_words is 'managed by 2026-12-28_daily_words.sql';

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY AND PRIVILEGES
-- ----------------------------------------------------------------------------
alter table public.daily_words enable row level security;

revoke all on public.daily_words from public, anon, authenticated;
-- READ: only the content columns (never the audit columns), for anon and signed-in users alike; the policies decide which ROWS.
grant select (id, profile_id, publish_on, status, title_en, title_fr, scripture_ref_en, scripture_ref_fr, scripture_text_en, scripture_text_fr, body_en, body_fr, prayer_en, prayer_fr, published_at, created_at, updated_at)
  on public.daily_words to anon, authenticated;
-- WRITE (signed-in users only): content columns and the status; profile_id only on insert. No TRUNCATE / REFERENCES / TRIGGER.
grant insert (id, profile_id, publish_on, status, title_en, title_fr, scripture_ref_en, scripture_ref_fr, scripture_text_en, scripture_text_fr, body_en, body_fr, prayer_en, prayer_fr)
  on public.daily_words to authenticated;
grant update (publish_on, status, title_en, title_fr, scripture_ref_en, scripture_ref_fr, scripture_text_en, scripture_text_fr, body_en, body_fr, prayer_en, prayer_fr)
  on public.daily_words to authenticated;
grant delete on public.daily_words to authenticated;
grant all on public.daily_words to service_role;

drop policy if exists daily_words_staff_select on public.daily_words;
create policy daily_words_staff_select on public.daily_words for select to authenticated
  using (public.church_has_permission(profile_id, 'church.content.view') or public.church_has_permission(profile_id, 'church.content.manage') or public.church_has_permission(profile_id, 'church.content.publish'));

drop policy if exists daily_words_public_select on public.daily_words;
create policy daily_words_public_select on public.daily_words for select to anon, authenticated
  using (status = 'published' and publish_on <= public.daily_word_today() and exists (select 1 from public.profiles p where p.id = profile_id and p.published = true));

-- publish permission: anything. manage permission: drafts only, and the row must still be a draft afterwards (so manage alone can never publish).
drop policy if exists daily_words_insert on public.daily_words;
create policy daily_words_insert on public.daily_words for insert to authenticated
  with check (public.church_has_permission(profile_id, 'church.content.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.content.manage')));
drop policy if exists daily_words_update on public.daily_words;
create policy daily_words_update on public.daily_words for update to authenticated
  using (public.church_has_permission(profile_id, 'church.content.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.content.manage')))
  with check (public.church_has_permission(profile_id, 'church.content.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.content.manage')));
drop policy if exists daily_words_delete on public.daily_words;
create policy daily_words_delete on public.daily_words for delete to authenticated
  using (public.church_has_permission(profile_id, 'church.content.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.content.manage')));

drop policy if exists daily_words_no_platform_admin_insert on public.daily_words;
create policy daily_words_no_platform_admin_insert on public.daily_words as restrictive for insert to authenticated
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists daily_words_no_platform_admin_update on public.daily_words;
create policy daily_words_no_platform_admin_update on public.daily_words as restrictive for update to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id))
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists daily_words_no_platform_admin_delete on public.daily_words;
create policy daily_words_no_platform_admin_delete on public.daily_words as restrictive for delete to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id));

-- ----------------------------------------------------------------------------
-- 4. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
declare
  v_pre jsonb := current_setting('daily_words.pre')::jsonb;
  v_marker constant text := 'managed by 2026-12-28_daily_words.sql';
  v_n int;
  v_bad text;
begin
  if coalesce(obj_description(to_regclass('public.daily_words'), 'pg_class'), '') <> v_marker then raise exception 'postcondition failed: table marker'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.daily_words'::regclass) then raise exception 'postcondition failed: row-level security is off'; end if;

  -- privileges: PUBLIC and anon have nothing but column SELECT; no API role has TRUNCATE / REFERENCES / TRIGGER; the audit columns are out of reach
  if has_table_privilege('public', 'public.daily_words', 'select') or has_table_privilege('public', 'public.daily_words', 'insert') then raise exception 'postcondition failed: PUBLIC has a table privilege'; end if;
  if has_table_privilege('anon', 'public.daily_words', 'select') or has_table_privilege('anon', 'public.daily_words', 'insert') or has_table_privilege('anon', 'public.daily_words', 'update') or has_table_privilege('anon', 'public.daily_words', 'delete') then
    raise exception 'postcondition failed: anon has a TABLE-level privilege (it must have column SELECT only)';
  end if;
  if has_table_privilege('authenticated', 'public.daily_words', 'truncate') or has_table_privilege('authenticated', 'public.daily_words', 'references') or has_table_privilege('authenticated', 'public.daily_words', 'trigger') then
    raise exception 'postcondition failed: authenticated can truncate, reference or trigger';
  end if;
  select string_agg(r || '.' || c || '.' || k, ', ') into v_bad
    from unnest(array['anon', 'authenticated']) r, unnest(array['created_by', 'updated_by', 'published_by']) c, unnest(array['select', 'insert', 'update']) k
   where has_column_privilege(r, 'public.daily_words', c, k);
  if v_bad is not null then raise exception 'postcondition failed: audit column reachable: %', v_bad; end if;
  if has_column_privilege('anon', 'public.daily_words', 'title_en', 'insert') or has_column_privilege('anon', 'public.daily_words', 'title_en', 'update') then raise exception 'postcondition failed: anon can write'; end if;
  if not has_column_privilege('anon', 'public.daily_words', 'title_en', 'select') then raise exception 'postcondition failed: anon cannot read the public columns'; end if;
  if has_column_privilege('authenticated', 'public.daily_words', 'profile_id', 'update') then raise exception 'postcondition failed: profile_id is updatable'; end if;

  -- policies: 3 permissive writes + 2 permissive reads + 3 restrictive, none for PUBLIC
  select count(*) into v_n from pg_policy where polrelid = 'public.daily_words'::regclass and polpermissive;
  if v_n <> 5 then raise exception 'postcondition failed: expected 5 permissive policies, found %', v_n; end if;
  select count(*) into v_n from pg_policy where polrelid = 'public.daily_words'::regclass and not polpermissive;
  if v_n <> 3 then raise exception 'postcondition failed: expected 3 restrictive policies, found %', v_n; end if;
  select count(*) into v_n from pg_policy where polrelid = 'public.daily_words'::regclass and polroles = array[0::oid];
  if v_n <> 0 then raise exception 'postcondition failed: a policy applies to PUBLIC'; end if;

  select count(*) into v_n from pg_trigger where tgrelid = 'public.daily_words'::regclass and not tgisinternal and tgname = 'daily_word_guard_trg';
  if v_n <> 1 then raise exception 'postcondition failed: guard trigger'; end if;
  select count(*) into v_n from pg_indexes where schemaname = 'public' and indexname = 'daily_words_one_published_per_day_key';
  if v_n <> 1 then raise exception 'postcondition failed: one-published-per-day index'; end if;

  -- nothing existing changed
  if (select count(*) from public.profiles) <> (v_pre->>'profiles')::bigint or (select count(*) from public.users) <> (v_pre->>'users')::bigint
     or (select count(*) from public.organization_roles) <> (v_pre->>'org_roles')::bigint or (select count(*) from public.organization_members) <> (v_pre->>'org_members')::bigint then
    raise exception 'postcondition failed: a row count of an existing table changed';
  end if;
  if (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
        from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass,
                                               'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass)) is distinct from v_pre->'policies' then
    raise exception 'postcondition failed: a policy of an existing table changed';
  end if;
  if (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
        from pg_proc f where f.pronamespace = 'public'::regnamespace
         and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile'))) is distinct from v_pre->'fn_defs' then
    raise exception 'postcondition failed: an existing function changed';
  end if;
end $$;

commit;
