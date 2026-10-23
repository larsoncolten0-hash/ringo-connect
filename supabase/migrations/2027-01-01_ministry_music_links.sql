-- Churches & Ministries Phase 8: Church Music (database foundation) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Adds ONE table, public.ministry_music_links, and one guard trigger function. Nothing existing is changed: no table, column, constraint, policy, trigger or function of Phase 0, Phase 2A, Phase 3-7, Team,
-- the music artist tables (tracks, music_releases, music orders, payouts) or anything else is altered, and no row is read or written. It CALLS (never modifies) the Phase 2A helpers is_church_profile(),
-- church_is_owner() and church_has_permission(), and the platform's is_admin().
--
--   NEW  public.ministry_music_links   a LINK-OUT on the church page: "listen on Spotify / YouTube / Apple Music / ...", with a label the church chooses
--   NEW  function ministry_music_link_guard()
--
-- WHAT THIS IS NOT: no audio file, no upload, no storage, no streaming, no sale, no licence, no payment, no artist account and no track catalogue. The existing music tables belong to the Music & Entertainment
-- category (artists who sell music through Ringo); a church page links out to wherever its music already lives, so none of them is reused or changed.
--
-- WHAT THE DATABASE REFUSES (for every writer, the service role included): a link that is not a secure https address with a real host (no credentials, no spaces, no script or data scheme, 500 characters at most);
-- an unknown platform; a label that is empty or over 80 characters; more than 20 links per church; the same address twice in one church; any link for a profile that is not a church; moving a link to another
-- church. The API additionally checks that the address belongs to the platform chosen (a "Spotify" link must be on a Spotify address).
--
-- ROW-LEVEL SECURITY
--   * staff read / write:  church.music.manage (church_has_permission: owner, or an ACTIVE member whose role holds the string; never a platform admin who is not the owner)
--   * public read:         anon and authenticated, only links the church left visible, of a published profile. A hidden link is never public.
--   * RESTRICTIVE policies on insert / update / delete refuse a platform admin who is not the church's owner.
--   * there is no policy for PUBLIC; every table privilege is revoked from it. The audit columns (created_by, updated_by) are readable and writable by NO API role.
--
-- PERMISSION (stored in organization_roles.permissions like every other permission): church.music.manage. The owner holds it implicitly; the Phase 2A grant guards treat every church.* string they do not
-- list as SENSITIVE (OWNER-ONLY to grant), so no Phase 2A object changes.
--
-- SELF-VERIFYING, one transaction: preconditions first, postconditions last. Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-12-27_church_people_groups.sql (is_church_profile, church_is_owner, church_has_permission), is_admin().
-- Preflight (read-only, run BEFORE): supabase/support/2027-01-01_ministry_music_links.preflight.sql
-- Verify    (read-only, run AFTER):  supabase/support/2027-01-01_ministry_music_links.verify.sql
-- Rollback: supabase/support/2027-01-01_ministry_music_links.rollback.sql (refuses to run while any row exists unless data loss is explicitly confirmed).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS + a snapshot of the objects this file must leave untouched
-- ----------------------------------------------------------------------------
do $$
declare
  v_marker constant text := 'managed by 2027-01-01_ministry_music_links.sql';
  v_missing text;
  v_bad text;
  v_have boolean := to_regclass('public.ministry_music_links') is not null;
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

  if v_have and coalesce(obj_description(to_regclass('public.ministry_music_links'), 'pg_class'), '') <> v_marker then
    raise exception 'precondition failed: public.ministry_music_links already exists and is not managed by this migration; refusing to adopt or re-mark it';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'ministry_music_link_guard' and (not v_have or coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker);
  if v_bad is not null then raise exception 'precondition failed: a function with this file''s name already exists and is not managed by it: %', v_bad; end if;
  if not v_have then
    select string_agg(c.relname, ', ') into v_bad from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'ministry\_music%';
    if v_bad is not null then raise exception 'precondition failed: relations named ministry_music* already exist: %', v_bad; end if;
  end if;

  perform set_config('ministry_music.pre', jsonb_build_object(
    'profiles',     (select count(*) from public.profiles),
    'users',        (select count(*) from public.users),
    'org_roles',    (select count(*) from public.organization_roles),
    'org_members',  (select count(*) from public.organization_members),
    'policies',     (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
                       from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass,
                                                              'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass)
                          or p.polrelid = to_regclass('public.daily_words') or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.ministry_announcements')
                          or p.polrelid = to_regclass('public.bible_programs') or p.polrelid = to_regclass('public.tracks') or p.polrelid = to_regclass('public.music_releases')),
    'fn_defs',      (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
                       from pg_proc f where f.pronamespace = 'public'::regnamespace
                        and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname like 'ministry\_%' or f.proname like 'bible\_%'
                             or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile')) and f.proname <> 'ministry_music_link_guard')
  )::text, true);
end $$;

-- ----------------------------------------------------------------------------
-- 1. TABLE
-- ----------------------------------------------------------------------------
create table if not exists public.ministry_music_links (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null,
  -- the label the church chooses ("Sunday worship playlist", "Our choir on YouTube")
  title text not null,
  url text not null,
  -- shown on the public page only while true
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  -- audit columns: filled by ministry_music_link_guard from auth.uid(); NOT readable or writable by any API role
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ministry_music_links_platform_check check (platform in ('spotify', 'apple_music', 'youtube', 'youtube_music', 'deezer', 'audiomack', 'boomplay', 'soundcloud', 'bandcamp', 'tidal', 'amazon_music', 'website', 'other')),
  constraint ministry_music_links_title_check check (char_length(btrim(title)) between 1 and 80),
  -- a secure address only: https, a real host (a dot), no credentials, no spaces, no query-less script or data scheme
  constraint ministry_music_links_url_check check (char_length(url) between 12 and 500 and url ~ '^https://[^\s/@?#]+\.[^\s/@?#]+([/?#]\S*)?$'),
  constraint ministry_music_links_sort_check check (sort_order between 0 and 1000)
);
create index if not exists ministry_music_links_profile_idx on public.ministry_music_links (profile_id, sort_order, created_at);
-- the same address cannot be added twice by one church (case-insensitive)
create unique index if not exists ministry_music_links_profile_url_key on public.ministry_music_links (profile_id, lower(url));

comment on table public.ministry_music_links is 'managed by 2027-01-01_ministry_music_links.sql';

-- ----------------------------------------------------------------------------
-- 2. FUNCTION
-- ----------------------------------------------------------------------------
-- Integrity and bookkeeping for every writer (the service role included): only a church profile, the church never changes, at most 20 links per church, and the audit columns come from the
-- authenticated caller (a value supplied by a client is overwritten).
create or replace function public.ministry_music_link_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_church_profile(new.profile_id) then
      raise exception 'music_profile_required' using errcode = '23514', detail = 'links can only be added to a profile with the Churches & Ministries category';
    end if;
    -- serialise concurrent inserts for ONE church so two simultaneous requests cannot both pass the count below
    perform pg_advisory_xact_lock(hashtextextended('ministry_music_links:' || new.profile_id::text, 0));
    if (select count(*) from public.ministry_music_links l where l.profile_id = new.profile_id) >= 20 then
      raise exception 'music_link_limit' using errcode = '23514', detail = 'a church page holds at most 20 music links';
    end if;
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.updated_by := auth.uid();
    end if;
  else
    if new.profile_id is distinct from old.profile_id then
      raise exception 'music_tenant_immutable' using errcode = '42501', detail = 'a link can never be moved to another church';
    end if;
    if auth.uid() is not null then
      new.created_by := old.created_by;
      new.updated_by := auth.uid();
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

comment on function public.ministry_music_link_guard() is 'managed by 2027-01-01_ministry_music_links.sql';
revoke all on function public.ministry_music_link_guard() from public, anon, authenticated;

drop trigger if exists ministry_music_links_guard_trg on public.ministry_music_links;
create trigger ministry_music_links_guard_trg before insert or update on public.ministry_music_links for each row execute function public.ministry_music_link_guard();
comment on trigger ministry_music_links_guard_trg on public.ministry_music_links is 'managed by 2027-01-01_ministry_music_links.sql';

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY AND PRIVILEGES
-- ----------------------------------------------------------------------------
alter table public.ministry_music_links enable row level security;

revoke all on public.ministry_music_links from public, anon, authenticated;
-- READ: only the content columns (never the audit columns), for anon and signed-in users alike; the policies decide which ROWS.
grant select (id, profile_id, platform, title, url, is_visible, sort_order, created_at, updated_at) on public.ministry_music_links to anon, authenticated;
-- WRITE (signed-in users only): content columns; profile_id only on insert. No TRUNCATE / REFERENCES / TRIGGER.
grant insert (id, profile_id, platform, title, url, is_visible, sort_order) on public.ministry_music_links to authenticated;
grant update (platform, title, url, is_visible, sort_order) on public.ministry_music_links to authenticated;
grant delete on public.ministry_music_links to authenticated;
grant all on public.ministry_music_links to service_role;

drop policy if exists ministry_music_links_staff_select on public.ministry_music_links;
create policy ministry_music_links_staff_select on public.ministry_music_links for select to authenticated
  using (public.church_has_permission(profile_id, 'church.music.manage'));

drop policy if exists ministry_music_links_public_select on public.ministry_music_links;
create policy ministry_music_links_public_select on public.ministry_music_links for select to anon, authenticated
  using (is_visible = true and exists (select 1 from public.profiles p where p.id = profile_id and p.published = true));

drop policy if exists ministry_music_links_insert on public.ministry_music_links;
create policy ministry_music_links_insert on public.ministry_music_links for insert to authenticated
  with check (public.church_has_permission(profile_id, 'church.music.manage'));
drop policy if exists ministry_music_links_update on public.ministry_music_links;
create policy ministry_music_links_update on public.ministry_music_links for update to authenticated
  using (public.church_has_permission(profile_id, 'church.music.manage'))
  with check (public.church_has_permission(profile_id, 'church.music.manage'));
drop policy if exists ministry_music_links_delete on public.ministry_music_links;
create policy ministry_music_links_delete on public.ministry_music_links for delete to authenticated
  using (public.church_has_permission(profile_id, 'church.music.manage'));

drop policy if exists ministry_music_links_no_platform_admin_insert on public.ministry_music_links;
create policy ministry_music_links_no_platform_admin_insert on public.ministry_music_links as restrictive for insert to authenticated
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists ministry_music_links_no_platform_admin_update on public.ministry_music_links;
create policy ministry_music_links_no_platform_admin_update on public.ministry_music_links as restrictive for update to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id))
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists ministry_music_links_no_platform_admin_delete on public.ministry_music_links;
create policy ministry_music_links_no_platform_admin_delete on public.ministry_music_links as restrictive for delete to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id));

-- ----------------------------------------------------------------------------
-- 4. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
declare
  v_pre jsonb := current_setting('ministry_music.pre')::jsonb;
  v_marker constant text := 'managed by 2027-01-01_ministry_music_links.sql';
  v_n int;
  v_bad text;
begin
  if coalesce(obj_description(to_regclass('public.ministry_music_links'), 'pg_class'), '') <> v_marker then raise exception 'postcondition failed: table marker'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.ministry_music_links'::regclass) then raise exception 'postcondition failed: row-level security is off'; end if;

  if has_table_privilege('public', 'public.ministry_music_links', 'select') or has_table_privilege('public', 'public.ministry_music_links', 'insert') then raise exception 'postcondition failed: PUBLIC has a table privilege'; end if;
  if has_table_privilege('anon', 'public.ministry_music_links', 'select') or has_table_privilege('anon', 'public.ministry_music_links', 'insert') or has_table_privilege('anon', 'public.ministry_music_links', 'update') or has_table_privilege('anon', 'public.ministry_music_links', 'delete') then
    raise exception 'postcondition failed: anon has a TABLE-level privilege (it must have column SELECT only)';
  end if;
  if has_table_privilege('authenticated', 'public.ministry_music_links', 'truncate') or has_table_privilege('authenticated', 'public.ministry_music_links', 'references') or has_table_privilege('authenticated', 'public.ministry_music_links', 'trigger') then
    raise exception 'postcondition failed: authenticated can truncate, reference or trigger';
  end if;
  select string_agg(r || '.' || c || '.' || k, ', ') into v_bad
    from unnest(array['anon', 'authenticated']) r, unnest(array['created_by', 'updated_by']) c, unnest(array['select', 'insert', 'update']) k
   where has_column_privilege(r, 'public.ministry_music_links', c, k);
  if v_bad is not null then raise exception 'postcondition failed: audit column reachable: %', v_bad; end if;
  if has_any_column_privilege('anon', 'public.ministry_music_links', 'insert') or has_any_column_privilege('anon', 'public.ministry_music_links', 'update') then raise exception 'postcondition failed: anon can write'; end if;
  if not has_column_privilege('anon', 'public.ministry_music_links', 'url', 'select') then raise exception 'postcondition failed: anon cannot read the public columns'; end if;
  if has_column_privilege('authenticated', 'public.ministry_music_links', 'profile_id', 'update') then raise exception 'postcondition failed: profile_id is updatable'; end if;
  if has_function_privilege('anon', 'public.ministry_music_link_guard()', 'execute') or has_function_privilege('authenticated', 'public.ministry_music_link_guard()', 'execute') or has_function_privilege('public', 'public.ministry_music_link_guard()', 'execute') then
    raise exception 'postcondition failed: the guard is callable';
  end if;

  select count(*) into v_n from pg_policy where polrelid = 'public.ministry_music_links'::regclass and polpermissive;
  if v_n <> 5 then raise exception 'postcondition failed: expected 5 permissive policies, found %', v_n; end if;
  select count(*) into v_n from pg_policy where polrelid = 'public.ministry_music_links'::regclass and not polpermissive;
  if v_n <> 3 then raise exception 'postcondition failed: expected 3 restrictive policies, found %', v_n; end if;
  select count(*) into v_n from pg_policy where polrelid = 'public.ministry_music_links'::regclass and polroles = array[0::oid];
  if v_n <> 0 then raise exception 'postcondition failed: a policy applies to PUBLIC'; end if;
  select count(*) into v_n from pg_trigger where tgrelid = 'public.ministry_music_links'::regclass and not tgisinternal and tgname = 'ministry_music_links_guard_trg';
  if v_n <> 1 then raise exception 'postcondition failed: guard trigger'; end if;
  select count(*) into v_n from pg_indexes where schemaname = 'public' and indexname = 'ministry_music_links_profile_url_key';
  if v_n <> 1 then raise exception 'postcondition failed: unique address index'; end if;

  -- nothing existing changed
  if (select count(*) from public.profiles) <> (v_pre->>'profiles')::bigint or (select count(*) from public.users) <> (v_pre->>'users')::bigint
     or (select count(*) from public.organization_roles) <> (v_pre->>'org_roles')::bigint or (select count(*) from public.organization_members) <> (v_pre->>'org_members')::bigint then
    raise exception 'postcondition failed: a row count of an existing table changed';
  end if;
  if (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
        from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass,
                                               'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass)
                           or p.polrelid = to_regclass('public.daily_words') or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.ministry_announcements')
                           or p.polrelid = to_regclass('public.bible_programs') or p.polrelid = to_regclass('public.tracks') or p.polrelid = to_regclass('public.music_releases')) is distinct from v_pre->'policies' then
    raise exception 'postcondition failed: a policy of an existing table changed';
  end if;
  if (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
        from pg_proc f where f.pronamespace = 'public'::regnamespace
         and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname like 'ministry\_%' or f.proname like 'bible\_%'
              or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile')) and f.proname <> 'ministry_music_link_guard') is distinct from v_pre->'fn_defs' then
    raise exception 'postcondition failed: an existing function changed';
  end if;
end $$;

commit;
