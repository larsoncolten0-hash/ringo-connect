-- Churches & Ministries Phase 2A: people, groups and leadership (database foundation) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Adds four church-owned tables, their tenant-safe keys, restrictive RLS, and an additive guard on who may hand out `church.*` permissions. Nothing existing is changed:
-- no existing table, column, constraint, policy, trigger or function is altered, and no row is read or written.
--
--   NEW  public.church_members         the church's own roster record for a person (may link to a Ringo account and/or a visitor identity, or neither)
--   NEW  public.church_groups          departments and groups (one table, `kind` tells them apart)
--   NEW  public.church_group_members   who belongs to which group, and in what role (leader, assistant, member, volunteer, worker)
--   NEW  public.church_leadership      titled leadership assignments with start/end dates
--   NEW  functions church_* (policy helpers) and team_church_* (grant guards), triggers on the four tables and three ADDITIVE triggers on the Team tables
--
-- WHAT THIS DOES NOT DO (deliberately; each is a later, separately approved step): no CSV export, no public join request, no public leadership display, no counselling,
-- donation or attendance data, no dashboard UI, no API route, no plan / pricing / seat change. Nothing in src/ reads or writes these tables yet.
--
-- ORGANIZATION MODEL (unchanged): a church IS a `profiles` row (see 2026-10-01_team_management.sql). Every row below carries `profile_id` and is only reachable through it.
--
-- TENANT ISOLATION
--   * every child table repeats `profile_id` and joins its parents with COMPOSITE keys, (group_id, profile_id) -> church_groups(id, profile_id) and
--     (member_id, profile_id) -> church_members(id, profile_id), so a row can never point at another church's group or person, whoever writes it (including the service role);
--   * `profile_id` can never be changed on any of the four tables, and a row can only be created for a profile that has the church category (primary or secondary);
--   * there is no policy for `anon` or PUBLIC, and all table privileges are revoked from them.
--
-- PLATFORM ADMINS ARE NOT CHURCH ADMINISTRATORS
--   `has_org_permission()` is true for any platform admin (it calls is_admin()). It is NOT used here and is NOT changed. The church tables use their own helpers, which never
--   consult admin status to GRANT anything, and every table also carries a RESTRICTIVE policy that refuses a platform admin who is not that church's owner (even if a future
--   permissive policy were added by mistake). The same applies to granting: an admin cannot create or assign a role holding any `church.*` permission (see the guard triggers).
--   Not preventable from inside the database: someone using the service role or direct database access (RLS does not apply to them) — that is an operational control.
--
-- PERMISSIONS (strings stored in organization_roles.permissions, like every other permission; the application catalogue gets them in Phase 2B)
--   ordinary:  church.members.view  church.members.manage  church.groups.view  church.groups.manage  church.leadership.view  church.leadership.manage
--   SENSITIVE (OWNER-ONLY to grant, change or reactivate; a manager or admin is refused):
--              church.children.view  church.children.manage  church.members.delete  church.export (reserved for a later phase)  and ANY other `church.*` string
--   The owner of a church implicitly holds all of them for their own church (as an owner already does for every other permission).
--   Ceiling: for `church.*` permissions this migration enforces "you cannot grant what you do not hold" itself, so it does NOT depend on 2026-10-07a being applied. If 07a and the
--   Inbox guard are applied, they keep working exactly as before and this migration adds to them; it replaces nothing.
--
-- CHILDREN
--   A child record stores a name, an age group and a guardian link — nothing else: no phone, no email, no Ringo account, no visitor identity, no self-registration (source = manual),
--   no date of birth, no photo, no school. The guardian must be an adult of the same church. A child can only ever hold the plain `member` role in a group and can never lead.
--   Reading a child needs `church.children.view` or `church.children.manage`, or being a leader / assistant of a group the child belongs to. Changing a child in ANY way (including turning
--   the record into an adult or youth one, or adding / removing the child from a group) needs `church.children.manage`, except that a group leader may remove a plain member from their group.
--   Both children permissions are owner-only to grant. The rules are RESTRICTIVE policies that no permissive policy can widen.
--   Leading a group exposes its children, so, for anyone who is not the owner:
--     * appointing a leader or assistant needs `church.members.view`, may never be done for oneself, and for a group that contains a child also needs `church.children.manage`;
--     * re-pointing the account link of someone who leads a group needs `church.children.manage`.
--     (church_group_members_guard / church_members_guard.) These two guards are security controls: removing either re-opens a path from `members.manage` + `groups.manage` to a group's children.
--   `church_group_members.is_child` is DERIVED: a trigger computes it from the person's age group on every insert and update of the membership (any value supplied by a caller is overwritten),
--   and a trigger on church_members refreshes it when the age group changes. It exists so that no callable function has to tell anyone another person's age group.
--
-- ACCOUNT DELETION AND RETENTION — see supabase/support/2026-12-27_church_people_groups.retention-policy.md. In short, and with NO automated erasure or anonymisation here:
--   * deleting a Ringo account (public.users) or a visitor identity (ringo_customers) only DETACHES the link (user_id / customer_id become NULL); the church's record is kept;
--   * soft removal (status = 'removed') keeps the record; a hard DELETE is a separate, owner-only act and cascades to that person's group memberships and leadership rows;
--   * deleting the church's profile deletes everything in these tables (as every other profile-scoped table does);
--   * hard-deleting an adult who is still the guardian of a child is refused until the child's record is dealt with first;
--   * deleting a church's OWNER account deletes their profile and therefore the whole roster (users -> profiles -> these tables, all ON DELETE CASCADE, as for every profile-scoped table).
--   NOT decided here (documented, deliberately unimplemented): whether removing or deactivating a guardian while a child depends on them should be blocked.
--   Deleting a group that holds a child needs `church.children.manage` (church_groups_delete_guard). That restricts a STAND-ALONE delete by a signed-in client. It does not restrict the
--   service role, nor the cascade that runs when a church's profile is deleted (by then the profile row is already gone, so the cascade is authorised by the profile's own delete policy:
--   its owner, or a platform admin — an existing platform power this migration does not change).
--   What is NOT decided (retention period, anonymise-on-account-deletion, age boundaries) is listed there as open policy decisions and is deliberately not implemented.
--
-- TABLE PRIVILEGES: everything is revoked from PUBLIC, anon and authenticated first, then authenticated gets only SELECT / INSERT / UPDATE / DELETE (so no TRUNCATE, which would skip
-- row-level security, and no REFERENCES or TRIGGER). The postconditions check this in the catalog.
--
-- NAME COLLISIONS: every function this file creates carries the comment 'managed by 2026-12-27_church_people_groups.sql', as do its three triggers on the Team tables. On a first run the
-- file refuses to start if ANY function with one of its names (any signature), any such trigger, or any relation called church_* already exists; on a re-run it refuses if one of them
-- lacks the comment (the four tables carry it too). The rollback refuses to drop anything that lacks it. So neither can overwrite or drop an unrelated object.
--
-- CONCURRENCY (source-level reasoning plus source checks; NOT proven by an executed concurrent test, because the offline test database has a single session):
--   * the guardian row is locked FOR SHARE while a child is validated against it, and the person's row FOR SHARE while a membership is validated against it;
--   * a group row is locked FOR UPDATE while a leader is appointed or a child is added, and church_members_age_sync takes the same group locks, in id order, when a person's age group
--     flips to or from `child`, so reclassifying a person cannot interleave with appointing a leader in a group that person belongs to; group deletion is serialised by the row lock the
--     DELETE itself takes.
--   Lock order is always: person row, then group rows (in id order). The one remaining deadlock shape is a multi-row statement that visits people in different orders; PostgreSQL detects
--   it and aborts one side (40P01), it cannot corrupt data.
--
-- SELF-VERIFYING, one transaction: preconditions first (every dependency exists, no half-applied state, no name collision), postconditions last (structure, row-level security,
-- privileges, key actions, triggers, and proof that the existing Team objects are byte-for-byte unchanged). Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-10-01_team_management.sql (organization_*, has_org_permission), 2026-10-17_ringo_customers_core.sql (ringo_customers), 2026-12-26_church_category.sql.
-- Preflight (read-only, run BEFORE): supabase/support/2026-12-27_church_people_groups.preflight.sql
-- Verify    (read-only, run AFTER):  supabase/support/2026-12-27_church_people_groups.verify.sql
-- Rollback: supabase/support/2026-12-27_church_people_groups.rollback.sql (refuses to run while any church row exists unless data loss is explicitly confirmed).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS + a snapshot of the objects this file must leave untouched
-- ----------------------------------------------------------------------------
do $$
declare
  v_missing text;
  v_have int;
  v_bad text;
  v_marker constant text := 'managed by 2026-12-27_church_people_groups.sql';
  v_expected text[] := array[
    'church_is_owner(uuid)', 'church_has_permission(uuid,text)', 'is_church_profile(uuid)', 'church_is_group_leader(uuid)', 'church_is_group_member(uuid)',
    'church_member_in_led_group(uuid)', 'church_member_is_me(uuid)', 'church_tenant_guard()', 'church_members_guard()', 'church_group_members_guard()',
    'church_leadership_guard()', 'church_members_age_sync()', 'church_groups_delete_guard()', 'team_church_permissions(text[])', 'team_church_permission_tier(text)',
    'team_church_change_denied(uuid,text[],text[])', 'team_role_church_permissions(uuid)', 'organization_roles_church_guard()',
    'organization_members_church_guard()', 'organization_invitations_church_guard()'];
  v_names text[];
begin
  select string_agg(t, ', ') into v_missing
    from unnest(array['profiles', 'users', 'ringo_customers', 'organization_roles', 'organization_members', 'organization_invitations']) t
   where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'precondition failed: missing tables: %', v_missing;
  end if;

  if to_regprocedure('public.is_admin()') is null or to_regprocedure('public.has_org_permission(uuid, text)') is null or to_regprocedure('public.is_org_member(uuid)') is null then
    raise exception 'precondition failed: is_admin(), has_org_permission(uuid, text) or is_org_member(uuid) is missing';
  end if;

  select string_agg(c, ', ') into v_missing
    from unnest(array['category', 'categories']) c
   where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = c);
  if v_missing is not null then
    raise exception 'precondition failed: public.profiles is missing columns: %', v_missing;
  end if;

  select string_agg(r, ', ') into v_missing from unnest(array['anon', 'authenticated', 'service_role']) r where not exists (select 1 from pg_roles where rolname = r);
  if v_missing is not null then
    raise exception 'precondition failed: missing database roles: %', v_missing;
  end if;

  -- Unknown-state guard: either none of the four tables exists (first run) or all four do (re-run); anything in between is a half-applied or foreign change.
  select count(*) into v_have from unnest(array['church_members', 'church_groups', 'church_group_members', 'church_leadership']) t where to_regclass('public.' || t) is not null;
  if v_have not in (0, 4) then
    raise exception 'precondition failed: only % of the 4 church people tables exist (half-applied state); resolve it before running this file', v_have;
  end if;

  -- On a re-run the four tables must already be OURS: refuse (never silently adopt or re-mark) tables that exist without the marker.
  if v_have = 4 then
    select string_agg(t, ', ') into v_bad from unnest(array['church_members', 'church_groups', 'church_group_members', 'church_leadership']) t
     where coalesce(obj_description(to_regclass('public.' || t), 'pg_class'), '') <> v_marker;
    if v_bad is not null then
      raise exception 'precondition failed: table(s) % already exist but are not marked as managed by this migration; refusing to adopt or re-mark them', v_bad;
    end if;
  end if;

  -- Name collisions. A function of ours that no longer exists (church_member_age_group, an earlier draft) counts as foreign too.
  v_names := array(select split_part(x, '(', 1) from unnest(v_expected) x) || array['church_member_age_group'];
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = any (v_names)
     and (v_have = 0 or p.oid::regprocedure::text <> all (v_expected) or coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker);
  if v_bad is not null then
    raise exception 'precondition failed: a function with one of this file''s names already exists and is not managed by it (it would be overwritten): %', v_bad;
  end if;
  select string_agg(g.tgrelid::regclass::text || '.' || g.tgname, ', ') into v_bad
    from pg_trigger g
   where not g.tgisinternal and g.tgname in ('organization_roles_church_guard_trg', 'organization_members_church_guard_trg', 'organization_invitations_church_guard_trg')
     and (v_have = 0 or coalesce(obj_description(g.oid, 'pg_trigger'), '') <> v_marker);
  if v_bad is not null then
    raise exception 'precondition failed: a trigger with one of this file''s names already exists and is not managed by it (it would be replaced): %', v_bad;
  end if;
  if v_have = 0 then
    select string_agg(c.relname, ', ') into v_bad from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'church\_%';
    if v_bad is not null then
      raise exception 'precondition failed: relations named church_* already exist but are not the four tables: %', v_bad;
    end if;
  end if;
  perform set_config('church_people.fns', array_to_string(v_expected, '|'), true);

  -- Snapshot, read back by the postconditions: row counts and the definition of every existing object this file promises not to change.
  perform set_config('church_people.pre', jsonb_build_object(
    'profiles',      (select count(*) from public.profiles),
    'users',         (select count(*) from public.users),
    'org_roles',     (select count(*) from public.organization_roles),
    'org_members',   (select count(*) from public.organization_members),
    'org_invites',   (select count(*) from public.organization_invitations),
    'org_policies',  (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
                       from pg_policy p where p.polrelid in ('public.organization_roles'::regclass, 'public.organization_members'::regclass, 'public.organization_invitations'::regclass, 'public.profiles'::regclass)),
    'org_triggers',  (select coalesce(jsonb_agg(g.tgrelid::regclass::text || '.' || g.tgname order by g.tgrelid::regclass::text, g.tgname), '[]'::jsonb)
                       from pg_trigger g where not g.tgisinternal and g.tgrelid in ('public.organization_roles'::regclass, 'public.organization_members'::regclass, 'public.organization_invitations'::regclass)
                        and g.tgname not like 'church\_%'),
    'fn_defs',       (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
                       from pg_proc f where f.pronamespace = 'public'::regnamespace and f.proname in ('is_admin', 'has_org_permission', 'is_org_member'))
  )::text, true);
end $$;

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.church_members (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Optional links. Deleting the account / visitor identity only detaches the link; the church's record stays (see the retention policy).
  user_id uuid references public.users(id) on delete set null,
  customer_id uuid references public.ringo_customers(id) on delete set null,
  full_name text not null,
  phone text,
  email text,
  preferred_language text,
  status text not null default 'active',
  source text not null default 'manual',
  age_group text not null default 'adult',
  guardian_member_id uuid,
  removed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- target of the composite keys of every child table: a child row can only ever point at a row of the SAME church
  constraint church_members_id_profile_key unique (id, profile_id),
  -- no ON DELETE action: an adult who is still someone's guardian cannot be hard-deleted until the dependent record is dealt with (NO ACTION is also cascade-safe)
  constraint church_members_guardian_fk foreign key (guardian_member_id, profile_id) references public.church_members (id, profile_id),
  constraint church_members_name_check check (char_length(btrim(full_name)) between 1 and 120),
  constraint church_members_phone_check check (phone is null or char_length(phone) <= 40),
  constraint church_members_email_check check (email is null or (email = lower(email) and char_length(email) between 3 and 200)),
  constraint church_members_language_check check (preferred_language is null or preferred_language in ('en', 'fr')),
  constraint church_members_status_check check (status in ('pending', 'active', 'inactive', 'removed')),
  constraint church_members_source_check check (source in ('manual', 'invite', 'join_request')),
  constraint church_members_age_group_check check (age_group in ('adult', 'youth', 'child')),
  constraint church_members_removed_at_check check ((status = 'removed') = (removed_at is not null)),
  constraint church_members_no_self_guardian_check check (guardian_member_id is null or guardian_member_id <> id),
  constraint church_members_adult_no_guardian_check check (age_group <> 'adult' or guardian_member_id is null),
  constraint church_members_child_guardian_check check (age_group <> 'child' or guardian_member_id is not null),
  -- a child record carries nothing but a name, an age group and the guardian link: no contact details, no account, no visitor identity, no self-registration
  constraint church_members_child_minimal_check check (age_group <> 'child' or (user_id is null and customer_id is null and phone is null and email is null and source = 'manual'))
);
create index if not exists church_members_profile_status_idx on public.church_members (profile_id, status);
create index if not exists church_members_profile_name_idx on public.church_members (profile_id, lower(full_name));
create index if not exists church_members_user_idx on public.church_members (user_id) where user_id is not null;
create index if not exists church_members_customer_idx on public.church_members (customer_id) where customer_id is not null;
create index if not exists church_members_guardian_idx on public.church_members (guardian_member_id) where guardian_member_id is not null;
create index if not exists church_members_children_idx on public.church_members (profile_id) where age_group = 'child';
-- one live record per account / visitor identity per church (a removed record does not block a later re-join)
create unique index if not exists church_members_profile_user_key on public.church_members (profile_id, user_id) where user_id is not null and status <> 'removed';
create unique index if not exists church_members_profile_customer_key on public.church_members (profile_id, customer_id) where customer_id is not null and status <> 'removed';

create table if not exists public.church_groups (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  name text not null,
  description text,
  status text not null default 'active',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint church_groups_id_profile_key unique (id, profile_id),
  constraint church_groups_kind_check check (kind in ('department', 'group')),
  constraint church_groups_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint church_groups_description_check check (description is null or char_length(description) <= 500),
  constraint church_groups_status_check check (status in ('active', 'archived'))
);
create index if not exists church_groups_profile_idx on public.church_groups (profile_id, kind, status);
create unique index if not exists church_groups_profile_kind_name_key on public.church_groups (profile_id, kind, lower(btrim(name))) where status = 'active';

create table if not exists public.church_group_members (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null,
  member_id uuid not null,
  role text not null default 'member',
  -- DERIVED from the person's age group by church_group_members_guard (callers cannot set it) and refreshed by church_members_age_sync_trg
  is_child boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint church_group_members_group_fk foreign key (group_id, profile_id) references public.church_groups (id, profile_id) on delete cascade,
  constraint church_group_members_member_fk foreign key (member_id, profile_id) references public.church_members (id, profile_id) on delete cascade,
  constraint church_group_members_group_member_key unique (group_id, member_id),
  constraint church_group_members_role_check check (role in ('leader', 'assistant', 'member', 'volunteer', 'worker'))
);
create index if not exists church_group_members_member_idx on public.church_group_members (member_id);
create index if not exists church_group_members_profile_idx on public.church_group_members (profile_id, group_id);
create index if not exists church_group_members_child_idx on public.church_group_members (group_id) where is_child;

create table if not exists public.church_leadership (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  member_id uuid not null,
  title text not null,
  started_on date,
  ended_on date,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint church_leadership_member_fk foreign key (member_id, profile_id) references public.church_members (id, profile_id) on delete cascade,
  constraint church_leadership_title_check check (char_length(btrim(title)) between 1 and 80),
  constraint church_leadership_dates_check check (started_on is null or ended_on is null or ended_on >= started_on)
);
create index if not exists church_leadership_profile_idx on public.church_leadership (profile_id);
create index if not exists church_leadership_member_idx on public.church_leadership (member_id);
create unique index if not exists church_leadership_open_title_key on public.church_leadership (profile_id, member_id, lower(btrim(title))) where ended_on is null;

comment on table public.church_members is 'managed by 2026-12-27_church_people_groups.sql';
comment on table public.church_groups is 'managed by 2026-12-27_church_people_groups.sql';
comment on table public.church_group_members is 'managed by 2026-12-27_church_people_groups.sql';
comment on table public.church_leadership is 'managed by 2026-12-27_church_people_groups.sql';

-- ----------------------------------------------------------------------------
-- 2. POLICY HELPERS. None of them calls has_org_permission(); none lets platform-admin status grant anything.
--    SECURITY DEFINER so the lookups are not themselves filtered by RLS; every one of them is anchored to auth.uid(), never to a value the caller supplies.
-- ----------------------------------------------------------------------------
create or replace function public.church_is_owner(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select auth.uid() is not null
     and exists (select 1 from public.profiles p where p.id = p_profile_id and p.user_id = auth.uid())
$$;

-- Owner of this church, or an ACTIVE member whose role (of the same church) holds the permission. Platform-admin accounts never qualify unless they are the owner.
create or replace function public.church_has_permission(p_profile_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select auth.uid() is not null
     and (
       public.church_is_owner(p_profile_id)
       or (
         not public.is_admin()
         and exists (
           select 1
             from public.organization_members m
             join public.organization_roles r on r.id = m.role_id and r.profile_id = m.profile_id
            where m.profile_id = p_profile_id and m.user_id = auth.uid() and m.status = 'active'
              and p_permission = any (r.permissions)
         )
       )
     )
$$;

create or replace function public.is_church_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_profile_id and (p.category = 'church_ministries' or 'church_ministries' = any (p.categories))
  )
$$;

-- Is the caller's own (linked, active, adult) roster record a leader or assistant of this active group?
create or replace function public.church_is_group_leader(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select auth.uid() is not null
     and not public.is_admin()
     and exists (
       select 1
         from public.church_group_members gm
         join public.church_members cm on cm.id = gm.member_id and cm.profile_id = gm.profile_id
         join public.church_groups g on g.id = gm.group_id and g.profile_id = gm.profile_id
        where gm.group_id = p_group_id and gm.role in ('leader', 'assistant')
          and cm.user_id = auth.uid() and cm.status = 'active' and cm.age_group = 'adult'
          and g.status = 'active'
     )
$$;

-- Is the caller's own (linked, active) roster record in this group, in any role?
create or replace function public.church_is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select auth.uid() is not null
     and not public.is_admin()
     and exists (
       select 1
         from public.church_group_members gm
         join public.church_members cm on cm.id = gm.member_id and cm.profile_id = gm.profile_id
        where gm.group_id = p_group_id and cm.user_id = auth.uid() and cm.status = 'active'
     )
$$;

-- Is this person a member of a group the caller leads?
create or replace function public.church_member_in_led_group(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select auth.uid() is not null
     and not public.is_admin()
     and exists (
       select 1
         from public.church_group_members tgm
         join public.church_group_members lgm on lgm.group_id = tgm.group_id and lgm.profile_id = tgm.profile_id
         join public.church_members lcm on lcm.id = lgm.member_id and lcm.profile_id = lgm.profile_id
         join public.church_groups g on g.id = tgm.group_id and g.profile_id = tgm.profile_id
        where tgm.member_id = p_member_id and lgm.role in ('leader', 'assistant')
          and lcm.user_id = auth.uid() and lcm.status = 'active' and lcm.age_group = 'adult'
          and g.status = 'active'
     )
$$;

-- Is this roster record the caller's own (linked) record?
create or replace function public.church_member_is_me(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select auth.uid() is not null
     and not public.is_admin()
     and exists (
       select 1 from public.church_members m
        where m.id = p_member_id and m.user_id = auth.uid() and m.status <> 'removed' and m.age_group <> 'child'
     )
$$;

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.church_members enable row level security;
alter table public.church_groups enable row level security;
alter table public.church_group_members enable row level security;
alter table public.church_leadership enable row level security;

-- Revoke EVERYTHING from the API roles first (Supabase's default privileges also give them TRUNCATE, REFERENCES and TRIGGER), then grant only what the policies need.
revoke all on public.church_members, public.church_groups, public.church_group_members, public.church_leadership from public, anon, authenticated;
grant select, insert, update, delete on public.church_members, public.church_groups, public.church_group_members, public.church_leadership to authenticated;
grant all on public.church_members, public.church_groups, public.church_group_members, public.church_leadership to service_role;

-- Reads and writes are PERMISSIVE per capability; the three RESTRICTIVE policies per table narrow them and cannot be widened by any permissive policy.

-- ---- church_members ---------------------------------------------------------
drop policy if exists church_members_staff_select on public.church_members;
create policy church_members_staff_select on public.church_members for select to authenticated
  using (age_group <> 'child' and public.church_has_permission(profile_id, 'church.members.view'));
drop policy if exists church_members_children_select on public.church_members;
create policy church_members_children_select on public.church_members for select to authenticated
  using (age_group = 'child' and public.church_has_permission(profile_id, 'church.children.view'));
drop policy if exists church_members_own_select on public.church_members;
create policy church_members_own_select on public.church_members for select to authenticated
  using (public.church_member_is_me(id));
drop policy if exists church_members_led_group_select on public.church_members;
create policy church_members_led_group_select on public.church_members for select to authenticated
  using (status <> 'removed' and public.church_member_in_led_group(id));
drop policy if exists church_members_insert on public.church_members;
create policy church_members_insert on public.church_members for insert to authenticated
  with check (public.church_has_permission(profile_id, 'church.members.manage') and source in ('manual', 'invite'));
drop policy if exists church_members_update on public.church_members;
create policy church_members_update on public.church_members for update to authenticated
  using (public.church_has_permission(profile_id, 'church.members.manage'))
  with check (public.church_has_permission(profile_id, 'church.members.manage') and source in ('manual', 'invite'));
drop policy if exists church_members_delete on public.church_members;
create policy church_members_delete on public.church_members for delete to authenticated
  using (public.church_has_permission(profile_id, 'church.members.delete'));
drop policy if exists church_members_no_platform_admin on public.church_members;
create policy church_members_no_platform_admin on public.church_members as restrictive for all to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id))
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists church_members_children_only on public.church_members;
create policy church_members_children_only on public.church_members as restrictive for all to authenticated
  using (age_group <> 'child' or public.church_has_permission(profile_id, 'church.children.view') or public.church_has_permission(profile_id, 'church.children.manage') or public.church_member_in_led_group(id))
  with check (age_group <> 'child' or public.church_has_permission(profile_id, 'church.children.manage'));
drop policy if exists church_members_children_delete on public.church_members;
create policy church_members_children_delete on public.church_members as restrictive for delete to authenticated
  using (age_group <> 'child' or public.church_has_permission(profile_id, 'church.children.manage'));
-- Editing an EXISTING child record in any way (including turning it into an adult or youth record) needs children.manage; seeing it (children.view) is not enough. The row's old values
-- are what USING tests, so a child can no longer be declassified by someone who can only view children.
drop policy if exists church_members_children_update on public.church_members;
create policy church_members_children_update on public.church_members as restrictive for update to authenticated
  using (age_group <> 'child' or public.church_has_permission(profile_id, 'church.children.manage'))
  with check (age_group <> 'child' or public.church_has_permission(profile_id, 'church.children.manage'));

-- ---- church_groups ------------------------------------------------------------
drop policy if exists church_groups_select on public.church_groups;
create policy church_groups_select on public.church_groups for select to authenticated
  using (public.church_has_permission(profile_id, 'church.groups.view') or public.church_has_permission(profile_id, 'church.groups.manage') or public.church_is_group_member(id));
drop policy if exists church_groups_insert on public.church_groups;
create policy church_groups_insert on public.church_groups for insert to authenticated
  with check (public.church_has_permission(profile_id, 'church.groups.manage'));
drop policy if exists church_groups_update on public.church_groups;
create policy church_groups_update on public.church_groups for update to authenticated
  using (public.church_has_permission(profile_id, 'church.groups.manage'))
  with check (public.church_has_permission(profile_id, 'church.groups.manage'));
drop policy if exists church_groups_delete on public.church_groups;
create policy church_groups_delete on public.church_groups for delete to authenticated
  using (public.church_has_permission(profile_id, 'church.groups.manage'));
drop policy if exists church_groups_no_platform_admin on public.church_groups;
create policy church_groups_no_platform_admin on public.church_groups as restrictive for all to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id))
  with check (not public.is_admin() or public.church_is_owner(profile_id));

-- ---- church_group_members -----------------------------------------------------
-- A group leader can read their group's roster and change or remove the non-leading rows of it. They cannot add people, cannot make anyone a leader or assistant,
-- and cannot touch a leading row (assigning leaders is `church.groups.manage`, i.e. the church's own administrators).
drop policy if exists church_group_members_select on public.church_group_members;
create policy church_group_members_select on public.church_group_members for select to authenticated
  using (
    public.church_has_permission(profile_id, 'church.groups.view') or public.church_has_permission(profile_id, 'church.groups.manage')
    or public.church_is_group_leader(group_id) or public.church_member_is_me(member_id)
  );
drop policy if exists church_group_members_insert on public.church_group_members;
create policy church_group_members_insert on public.church_group_members for insert to authenticated
  with check (public.church_has_permission(profile_id, 'church.groups.manage'));
drop policy if exists church_group_members_update on public.church_group_members;
create policy church_group_members_update on public.church_group_members for update to authenticated
  using (public.church_has_permission(profile_id, 'church.groups.manage') or (public.church_is_group_leader(group_id) and role in ('member', 'volunteer', 'worker')))
  with check (public.church_has_permission(profile_id, 'church.groups.manage') or (public.church_is_group_leader(group_id) and role in ('member', 'volunteer', 'worker')));
drop policy if exists church_group_members_delete on public.church_group_members;
create policy church_group_members_delete on public.church_group_members for delete to authenticated
  using (public.church_has_permission(profile_id, 'church.groups.manage') or (public.church_is_group_leader(group_id) and role in ('member', 'volunteer', 'worker')));
drop policy if exists church_group_members_no_platform_admin on public.church_group_members;
create policy church_group_members_no_platform_admin on public.church_group_members as restrictive for all to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id))
  with check (not public.is_admin() or public.church_is_owner(profile_id));
-- a child's membership is as protected as the child's own record
drop policy if exists church_group_members_children_only on public.church_group_members;
create policy church_group_members_children_only on public.church_group_members as restrictive for all to authenticated
  using (
    not is_child
    or public.church_has_permission(profile_id, 'church.children.view') or public.church_has_permission(profile_id, 'church.children.manage')
    or public.church_is_group_leader(group_id)
  )
  with check (not is_child or public.church_has_permission(profile_id, 'church.children.manage'));
-- changing or removing a child's membership: children.manage, except that a group leader may still remove a plain member from the group they lead
drop policy if exists church_group_members_children_update on public.church_group_members;
create policy church_group_members_children_update on public.church_group_members as restrictive for update to authenticated
  using (not is_child or public.church_has_permission(profile_id, 'church.children.manage') or public.church_is_group_leader(group_id))
  with check (not is_child or public.church_has_permission(profile_id, 'church.children.manage') or public.church_is_group_leader(group_id));
drop policy if exists church_group_members_children_delete on public.church_group_members;
create policy church_group_members_children_delete on public.church_group_members as restrictive for delete to authenticated
  using (not is_child or public.church_has_permission(profile_id, 'church.children.manage') or public.church_is_group_leader(group_id));

-- ---- church_leadership --------------------------------------------------------
drop policy if exists church_leadership_select on public.church_leadership;
create policy church_leadership_select on public.church_leadership for select to authenticated
  using (public.church_has_permission(profile_id, 'church.leadership.view') or public.church_has_permission(profile_id, 'church.leadership.manage') or public.church_member_is_me(member_id));
drop policy if exists church_leadership_insert on public.church_leadership;
create policy church_leadership_insert on public.church_leadership for insert to authenticated
  with check (public.church_has_permission(profile_id, 'church.leadership.manage'));
drop policy if exists church_leadership_update on public.church_leadership;
create policy church_leadership_update on public.church_leadership for update to authenticated
  using (public.church_has_permission(profile_id, 'church.leadership.manage'))
  with check (public.church_has_permission(profile_id, 'church.leadership.manage'));
drop policy if exists church_leadership_delete on public.church_leadership;
create policy church_leadership_delete on public.church_leadership for delete to authenticated
  using (public.church_has_permission(profile_id, 'church.leadership.manage'));
drop policy if exists church_leadership_no_platform_admin on public.church_leadership;
create policy church_leadership_no_platform_admin on public.church_leadership as restrictive for all to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id))
  with check (not public.is_admin() or public.church_is_owner(profile_id));

-- ----------------------------------------------------------------------------
-- 4. INTEGRITY TRIGGERS ON THE FOUR TABLES (apply to every writer, the service role included)
-- ----------------------------------------------------------------------------
create or replace function public.church_tenant_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_church_profile(new.profile_id) then
      raise exception 'church_profile_required' using errcode = '23514', detail = 'rows can only be created for a profile with the Churches & Ministries category';
    end if;
  else
    if new.profile_id is distinct from old.profile_id then
      raise exception 'church_tenant_immutable' using errcode = '42501', detail = 'a church record can never be moved to another church';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.church_members_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_guardian_age text;
begin
  if new.status = 'removed' then
    new.removed_at := coalesce(new.removed_at, now());
  else
    new.removed_at := null;
  end if;

  -- a guardian must be an adult of the same church
  if new.guardian_member_id is not null then
    -- FOR SHARE: while this row is being written, nobody can change the guardian's age group (their UPDATE waits, then re-checks against us). Together with the dependents
    -- check below, which runs under the guardian row's own update lock, a guardian cannot be made a non-adult at the same moment a child is attached.
    select g.age_group into v_guardian_age from public.church_members g where g.id = new.guardian_member_id and g.profile_id = new.profile_id for share;
    if v_guardian_age is distinct from 'adult' then
      raise exception 'church_guardian_must_be_adult' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- Re-pointing the account link of someone who leads a group would hand that group (and any child in it) to a different account: owner, or children.manage, only.
    if auth.uid() is not null and new.user_id is distinct from old.user_id
       and exists (select 1 from public.church_group_members gm where gm.member_id = new.id and gm.role in ('leader', 'assistant'))
       and not public.church_has_permission(new.profile_id, 'church.children.manage') then
      raise exception 'church_leader_link_denied' using errcode = '42501', detail = 'the account of a group leader can only be changed by the owner or a holder of church.children.manage';
    end if;
    -- an adult who is someone's guardian cannot stop being an adult
    if old.age_group = 'adult' and new.age_group <> 'adult' and exists (select 1 from public.church_members c where c.guardian_member_id = new.id) then
      raise exception 'church_guardian_has_dependents' using errcode = '23514';
    end if;
    -- leading roles and leadership titles belong to adults; a child can only ever be a plain group member
    if new.age_group <> 'adult' and (
         exists (select 1 from public.church_group_members gm where gm.member_id = new.id and gm.role in ('leader', 'assistant'))
         or exists (select 1 from public.church_leadership l where l.member_id = new.id)
       ) then
      raise exception 'church_role_requires_adult' using errcode = '23514';
    end if;
    if new.age_group = 'child' and exists (select 1 from public.church_group_members gm where gm.member_id = new.id and gm.role <> 'member') then
      raise exception 'church_child_role_denied' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.church_group_members_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_age text;
  v_status text;
  v_user uuid;
begin
  if tg_op = 'UPDATE' and (new.group_id is distinct from old.group_id or new.member_id is distinct from old.member_id) then
    raise exception 'church_membership_link_immutable' using errcode = '42501', detail = 'remove the membership and add a new one instead';
  end if;
  -- FOR SHARE: the person's row cannot change age group / account link / status under us until this statement ends
  select m.age_group, m.status, m.user_id into v_age, v_status, v_user from public.church_members m where m.id = new.member_id and m.profile_id = new.profile_id for share;
  -- is_child is DERIVED here, always: whatever the caller supplied is overwritten
  new.is_child := coalesce(v_age = 'child', false);
  if tg_op = 'INSERT' and v_status is distinct from 'active' then
    raise exception 'church_member_not_active' using errcode = '23514', detail = 'only an active member can be added to a group';
  end if;
  -- Appointing a leader and adding a child to the same group must not interleave: take the group row's lock first.
  if new.is_child or new.role in ('leader', 'assistant') then
    perform 1 from public.church_groups g where g.id = new.group_id and g.profile_id = new.profile_id for update;
  end if;
  -- A leading role (leader / assistant) lets its holder read the whole group, including any children in it. So a client (anyone with an end-user identity) may only hand one out
  -- if they are the owner, or hold church.members.view, are not assigning themselves, and, when the group contains a child, also hold church.children.manage.
  -- Taking a leading role away (demoting) is not restricted here.
  if auth.uid() is not null and new.role in ('leader', 'assistant') and (tg_op = 'INSERT' or old.role is distinct from new.role) and not public.church_is_owner(new.profile_id) then
    if not public.church_has_permission(new.profile_id, 'church.members.view') or v_user is not distinct from auth.uid() then
      raise exception 'church_leader_assignment_denied' using errcode = '42501', detail = 'only the owner, or a church admin who can view members and is not assigning themselves, can appoint a leader';
    end if;
    if exists (select 1 from public.church_group_members gm where gm.group_id = new.group_id and gm.is_child)
       and not public.church_has_permission(new.profile_id, 'church.children.manage') then
      raise exception 'church_leader_assignment_denied' using errcode = '42501', detail = 'a group that contains children needs church.children.manage to appoint a leader';
    end if;
  end if;
  if new.is_child and new.role <> 'member' then
    raise exception 'church_child_role_denied' using errcode = '23514', detail = 'a child can only be a plain group member';
  end if;
  if new.role in ('leader', 'assistant') and v_age is distinct from 'adult' then
    raise exception 'church_role_requires_adult' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Keeps church_group_members.is_child in step when a person's age group changes (the membership guard recomputes it from the person's row, which this transaction holds locked),
-- and takes the group locks described under CONCURRENCY in the header.
create or replace function public.church_members_age_sync()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.age_group is distinct from old.age_group then
    -- When the person becomes (or stops being) a child, take the same group locks the membership guard takes, in id order (so two such updates cannot deadlock each other), BEFORE the
    -- flag flips: a leader appointment in one of this person's groups then either completes first (and the group had no child when it was checked) or waits and sees the child.
    if (old.age_group = 'child') is distinct from (new.age_group = 'child') then
      perform 1 from public.church_groups g
       where g.profile_id = new.profile_id and g.id in (select gm.group_id from public.church_group_members gm where gm.member_id = new.id and gm.profile_id = new.profile_id)
       order by g.id for update;
    end if;
    update public.church_group_members gm
       set is_child = (new.age_group = 'child')
     where gm.member_id = new.id and gm.profile_id = new.profile_id and gm.is_child is distinct from (new.age_group = 'child');
  end if;
  return null;
end;
$$;

create or replace function public.church_leadership_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_age text;
  v_status text;
begin
  if tg_op = 'UPDATE' and new.member_id is distinct from old.member_id then
    raise exception 'church_membership_link_immutable' using errcode = '42501', detail = 'end the assignment and create a new one instead';
  end if;
  select m.age_group, m.status into v_age, v_status from public.church_members m where m.id = new.member_id and m.profile_id = new.profile_id;
  if v_age is distinct from 'adult' then
    raise exception 'church_role_requires_adult' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and v_status is distinct from 'active' then
    raise exception 'church_member_not_active' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- A group that holds a child cannot be deleted by a client who lacks church.children.manage: the delete would remove the child's membership (and the DELETE cascades past row-level
-- security). Not callable by anyone, so it cannot be used to ask whether a group holds a child. Not restricted: no end-user identity (the service role), and the cascade from deleting the
-- church's PROFILE — detected because the profile row no longer exists by the time the cascade reaches the group (a stand-alone delete always still sees it, the foreign key guarantees it);
-- that cascade is authorised by the profile's own delete policy. The church's owner holds the permission for a stand-alone delete. The DELETE takes the group row's lock before this runs,
-- which serialises it against a concurrent child being added (the insert locks the same row).
create or replace function public.church_groups_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if auth.uid() is not null
     and exists (select 1 from public.profiles p where p.id = old.profile_id)
     and exists (select 1 from public.church_group_members gm where gm.group_id = old.id and gm.profile_id = old.profile_id and gm.is_child)
     and not public.church_has_permission(old.profile_id, 'church.children.manage') then
    raise exception 'church_group_has_children' using errcode = '42501', detail = 'a group that holds a child can only be deleted by the owner or a holder of church.children.manage';
  end if;
  return old;
end;
$$;

drop trigger if exists church_tenant_guard_trg on public.church_members;
create trigger church_tenant_guard_trg before insert or update on public.church_members for each row execute function public.church_tenant_guard();
drop trigger if exists church_tenant_guard_trg on public.church_groups;
create trigger church_tenant_guard_trg before insert or update on public.church_groups for each row execute function public.church_tenant_guard();
drop trigger if exists church_tenant_guard_trg on public.church_group_members;
create trigger church_tenant_guard_trg before insert or update on public.church_group_members for each row execute function public.church_tenant_guard();
drop trigger if exists church_tenant_guard_trg on public.church_leadership;
create trigger church_tenant_guard_trg before insert or update on public.church_leadership for each row execute function public.church_tenant_guard();

drop trigger if exists church_members_guard_trg on public.church_members;
create trigger church_members_guard_trg before insert or update on public.church_members for each row execute function public.church_members_guard();
drop trigger if exists church_members_age_sync_trg on public.church_members;
create trigger church_members_age_sync_trg after update of age_group on public.church_members for each row execute function public.church_members_age_sync();
drop trigger if exists church_group_members_guard_trg on public.church_group_members;
create trigger church_group_members_guard_trg before insert or update on public.church_group_members for each row execute function public.church_group_members_guard();
drop trigger if exists church_leadership_guard_trg on public.church_leadership;
create trigger church_leadership_guard_trg before insert or update on public.church_leadership for each row execute function public.church_leadership_guard();
drop trigger if exists church_groups_delete_guard_trg on public.church_groups;
create trigger church_groups_delete_guard_trg before delete on public.church_groups for each row execute function public.church_groups_delete_guard();

-- ----------------------------------------------------------------------------
-- 5. GRANT GUARDS ON THE TEAM TABLES (ADDITIVE: three new triggers beside the existing ones; no existing trigger, policy or function is touched)
--    Who may hand out `church.*` permissions: the church's OWNER for everything; anyone else only for the ORDINARY permissions, only if they hold them, and never a
--    platform admin. Anything sensitive (or any `church.*` string this file does not know) is owner-only, like `inbox.*` (2026-12-13). The service role and direct
--    database access carry no end-user identity and are not affected (the invitation-accept route creates memberships that way).
-- ----------------------------------------------------------------------------
-- The distinct, normalised `church.*` subset of a permission list (so 'Church.Members.View' and ' church.children.view ' cannot slip past).
create or replace function public.team_church_permissions(p_permissions text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct lower(btrim(x)) order by lower(btrim(x))), '{}'::text[])
    from unnest(coalesce(p_permissions, '{}'::text[])) as x
   where lower(btrim(x)) like 'church.%'
$$;

-- 1 = ordinary, 2 = sensitive (owner-only). Unknown `church.*` strings are sensitive until a later migration classifies them.
create or replace function public.team_church_permission_tier(p_permission text)
returns int
language sql
immutable
as $$
  select case when lower(btrim(coalesce(p_permission, ''))) in
    ('church.members.view', 'church.members.manage', 'church.groups.view', 'church.groups.manage', 'church.leadership.view', 'church.leadership.manage')
    then 1 else 2 end
$$;

-- The reason the CURRENT caller may not make this change, or NULL when they may.
--   p_touched  every church permission gained or lost by the change   p_added  the ones that become newly available to someone
create or replace function public.team_church_change_denied(p_profile_id uuid, p_touched text[], p_added text[])
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  p text;
begin
  if auth.uid() is null then return null; end if;
  if cardinality(coalesce(p_touched, '{}'::text[])) = 0 then return null; end if;
  if p_profile_id is null then return 'church_permission_owner_only'; end if;
  if public.church_is_owner(p_profile_id) then return null; end if;
  if public.is_admin() then return 'church_permission_admin_denied'; end if;
  foreach p in array p_touched loop
    if public.team_church_permission_tier(p) = 2 then return 'church_permission_owner_only'; end if;
  end loop;
  foreach p in array coalesce(p_added, '{}'::text[]) loop
    if not public.church_has_permission(p_profile_id, p) then return 'church_permission_ceiling'; end if;
  end loop;
  return null;
end;
$$;

create or replace function public.team_role_church_permissions(p_role_id uuid)
returns text[]
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce((select public.team_church_permissions(r.permissions) from public.organization_roles r where r.id = p_role_id), '{}'::text[])
$$;

create or replace function public.organization_roles_church_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_old text[] := '{}'::text[];
  v_new text[] := public.team_church_permissions(new.permissions);
  v_added text[];
  v_touched text[];
  v_why text;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' then v_old := public.team_church_permissions(old.permissions); end if;
  v_added := array(select unnest(v_new) except select unnest(v_old));
  v_touched := v_added || array(select unnest(v_old) except select unnest(v_new));
  v_why := public.team_church_change_denied(new.profile_id, v_touched, v_added);
  if v_why is not null then raise exception '%', v_why using errcode = '42501'; end if;
  -- a role holding church permissions can only be moved between churches by the owner of both
  if tg_op = 'UPDATE' and new.profile_id is distinct from old.profile_id and (cardinality(v_old) > 0 or cardinality(v_new) > 0)
     and not (public.church_is_owner(old.profile_id) and public.church_is_owner(new.profile_id)) then
    raise exception 'church_permission_owner_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.organization_members_church_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_old text[] := '{}'::text[];
  v_new text[] := public.team_role_church_permissions(new.role_id);
  v_touched text[];
  v_why text;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    v_touched := v_new;
  else
    v_old := public.team_role_church_permissions(old.role_id);
    if new.role_id is distinct from old.role_id or new.profile_id is distinct from old.profile_id or new.user_id is distinct from old.user_id
       or (old.status is distinct from 'active' and new.status = 'active') then
      v_touched := array(select unnest(v_new) union select unnest(v_old));
    else
      v_touched := '{}'::text[]; -- deactivating or removing a member only takes access away
    end if;
  end if;
  v_why := public.team_church_change_denied(new.profile_id, v_touched, v_new);
  if v_why is not null then raise exception '%', v_why using errcode = '42501'; end if;
  if tg_op = 'UPDATE' and new.profile_id is distinct from old.profile_id and (cardinality(v_old) > 0 or cardinality(v_new) > 0)
     and not (public.church_is_owner(old.profile_id) and public.church_is_owner(new.profile_id)) then
    raise exception 'church_permission_owner_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.organization_invitations_church_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_old text[] := '{}'::text[];
  v_new text[] := public.team_role_church_permissions(new.role_id);
  v_touched text[];
  v_why text;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    v_touched := v_new;
  else
    v_old := public.team_role_church_permissions(old.role_id);
    -- taking an invitation away (revoked / cancelled / expired) stays open to whoever could already do it; anything else counts as modifying it
    if (to_jsonb(new) - 'status' - 'updated_at') is not distinct from (to_jsonb(old) - 'status' - 'updated_at')
       and (new.status is not distinct from old.status or new.status in ('revoked', 'cancelled', 'expired')) then
      v_touched := '{}'::text[];
    else
      v_touched := array(select unnest(v_new) union select unnest(v_old));
    end if;
  end if;
  v_why := public.team_church_change_denied(new.profile_id, v_touched, v_new);
  if v_why is not null then raise exception '%', v_why using errcode = '42501'; end if;
  return new;
end;
$$;

drop trigger if exists organization_roles_church_guard_trg on public.organization_roles;
create trigger organization_roles_church_guard_trg before insert or update on public.organization_roles for each row execute function public.organization_roles_church_guard();
drop trigger if exists organization_members_church_guard_trg on public.organization_members;
create trigger organization_members_church_guard_trg before insert or update on public.organization_members for each row execute function public.organization_members_church_guard();
drop trigger if exists organization_invitations_church_guard_trg on public.organization_invitations;
create trigger organization_invitations_church_guard_trg before insert or update on public.organization_invitations for each row execute function public.organization_invitations_church_guard();

-- ----------------------------------------------------------------------------
-- 6. FUNCTION PRIVILEGES. Policy helpers run as the signed-in user, so `authenticated` needs EXECUTE on them; nothing else is ever callable by anon or PUBLIC. Trigger functions and the
--    grant-guard helpers are never called by a client: nobody needs EXECUTE on them.
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.oid::regprocedure::text = any (string_to_array(current_setting('church_people.fns'), '|'))
              and p.proname in ('church_is_owner', 'church_has_permission', 'is_church_profile', 'church_is_group_leader', 'church_is_group_member',
                                'church_member_in_led_group', 'church_member_is_me', 'church_tenant_guard', 'church_members_guard', 'church_group_members_guard', 'church_leadership_guard',
                                'church_members_age_sync', 'church_groups_delete_guard', 'team_church_permissions', 'team_church_permission_tier', 'team_church_change_denied', 'team_role_church_permissions',
                                'organization_roles_church_guard', 'organization_members_church_guard', 'organization_invitations_church_guard')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname in ('church_is_owner', 'church_has_permission', 'is_church_profile', 'church_is_group_leader', 'church_is_group_member', 'church_member_in_led_group', 'church_member_is_me') then
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
    end if;
    execute format('comment on function %s is %L', r.sig, 'managed by 2026-12-27_church_people_groups.sql');
  end loop;
end $$;
comment on trigger organization_roles_church_guard_trg on public.organization_roles is 'managed by 2026-12-27_church_people_groups.sql';
comment on trigger organization_members_church_guard_trg on public.organization_members is 'managed by 2026-12-27_church_people_groups.sql';
comment on trigger organization_invitations_church_guard_trg on public.organization_invitations is 'managed by 2026-12-27_church_people_groups.sql';

-- ----------------------------------------------------------------------------
-- 7. POSTCONDITIONS
-- ----------------------------------------------------------------------------
do $$
declare
  v_pre jsonb := current_setting('church_people.pre', true)::jsonb;
  v_bad text;
  v_n bigint;
  t text;
begin
  if v_pre is null then raise exception 'postcondition failed: the precondition snapshot is missing'; end if;

  -- 7a. four tables, row-level security on, no privileges for anon / PUBLIC, only authenticated policies
  foreach t in array array['church_members', 'church_groups', 'church_group_members', 'church_leadership'] loop
    if to_regclass('public.' || t) is null then raise exception 'postcondition failed: public.% is missing', t; end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then raise exception 'postcondition failed: row-level security is off on %', t; end if;
    if has_table_privilege('public', 'public.' || t, 'select, insert, update, delete') then raise exception 'postcondition failed: PUBLIC has a privilege on %', t; end if;
    if exists (select 1 from pg_roles where rolname = 'anon') and (
         has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('anon', 'public.' || t, 'insert')
         or has_table_privilege('anon', 'public.' || t, 'update') or has_table_privilege('anon', 'public.' || t, 'delete')) then
      raise exception 'postcondition failed: anon has a privilege on %', t;
    end if;
    select count(*) into v_n from pg_policy p where p.polrelid = ('public.' || t)::regclass
      and p.polroles <> array[(select oid from pg_roles where rolname = 'authenticated')];
    if v_n > 0 then raise exception 'postcondition failed: % has a policy that is not limited to authenticated', t; end if;
    select count(*) into v_n from pg_policy p where p.polrelid = ('public.' || t)::regclass and not p.polpermissive;
    if v_n < 1 then raise exception 'postcondition failed: % has no RESTRICTIVE policy', t; end if;
  end loop;
  select count(*) into v_n from pg_policy p where p.polrelid = 'public.church_members'::regclass and not p.polpermissive;
  if v_n < 4 then raise exception 'postcondition failed: church_members needs its 4 restrictive policies (found %)', v_n; end if;
  select count(*) into v_n from pg_policy p where p.polrelid = 'public.church_group_members'::regclass and not p.polpermissive;
  if v_n < 4 then raise exception 'postcondition failed: church_group_members needs its 4 restrictive policies (found %)', v_n; end if;

  -- 7a2. table privileges: authenticated has exactly the four DML privileges, nothing else (no TRUNCATE / REFERENCES / TRIGGER); anon and PUBLIC have none
  foreach t in array array['church_members', 'church_groups', 'church_group_members', 'church_leadership'] loop
    if not (has_table_privilege('authenticated', 'public.' || t, 'select') and has_table_privilege('authenticated', 'public.' || t, 'insert')
            and has_table_privilege('authenticated', 'public.' || t, 'update') and has_table_privilege('authenticated', 'public.' || t, 'delete')) then
      raise exception 'postcondition failed: authenticated lacks a DML privilege on %', t;
    end if;
    if has_table_privilege('authenticated', 'public.' || t, 'truncate') or has_table_privilege('authenticated', 'public.' || t, 'references') or has_table_privilege('authenticated', 'public.' || t, 'trigger') then
      raise exception 'postcondition failed: authenticated holds TRUNCATE, REFERENCES or TRIGGER on %', t;
    end if;
  end loop;

  -- 7a3. the age-group helper is gone, is_child exists and agrees with every person's age group, and every function / trigger of ours is marked as ours (and nothing else is)
  if to_regprocedure('public.church_member_age_group(uuid)') is not null then raise exception 'postcondition failed: church_member_age_group still exists'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'church_group_members' and column_name = 'is_child') then
    raise exception 'postcondition failed: church_group_members.is_child is missing';
  end if;
  select count(*) into v_n from public.church_group_members gm join public.church_members m on m.id = gm.member_id and m.profile_id = gm.profile_id where gm.is_child is distinct from (m.age_group = 'child');
  if v_n > 0 then raise exception 'postcondition failed: % membership(s) disagree with the person''s age group', v_n; end if;
  select string_agg(x, ', ') into v_bad from unnest(string_to_array(current_setting('church_people.fns'), '|')) x
   where to_regprocedure('public.' || x) is null or coalesce(obj_description(to_regprocedure('public.' || x), 'pg_proc'), '') <> 'managed by 2026-12-27_church_people_groups.sql';
  if v_bad is not null then raise exception 'postcondition failed: function missing or not marked as managed by this file: %', v_bad; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and obj_description(p.oid, 'pg_proc') = 'managed by 2026-12-27_church_people_groups.sql'
     and p.oid::regprocedure::text <> all (string_to_array(current_setting('church_people.fns'), '|'));
  if v_bad is not null then raise exception 'postcondition failed: an unexpected function carries this file''s marker: %', v_bad; end if;
  select string_agg(x.tgname, ', ') into v_bad
    from (values ('organization_roles', 'organization_roles_church_guard_trg'), ('organization_members', 'organization_members_church_guard_trg'), ('organization_invitations', 'organization_invitations_church_guard_trg')) x(rel, tgname)
   where not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || x.rel)::regclass and g.tgname = x.tgname and obj_description(g.oid, 'pg_trigger') = 'managed by 2026-12-27_church_people_groups.sql');
  if v_bad is not null then raise exception 'postcondition failed: Team guard trigger not marked as managed by this file: %', v_bad; end if;
  select string_agg(x, ', ') into v_bad from unnest(array['church_members', 'church_groups', 'church_group_members', 'church_leadership']) x
   where coalesce(obj_description(('public.' || x)::regclass, 'pg_class'), '') <> 'managed by 2026-12-27_church_people_groups.sql';
  if v_bad is not null then raise exception 'postcondition failed: table not marked as managed by this file: %', v_bad; end if;

  -- 7b. key actions: profile cascades, account / visitor links detach, composite keys cascade, the guardian key refuses
  select string_agg(x.conname, ', ') into v_bad
    from (values ('church_members_profile_id_fkey', 'c'), ('church_members_user_id_fkey', 'n'), ('church_members_customer_id_fkey', 'n'), ('church_members_guardian_fk', 'a'),
                 ('church_groups_profile_id_fkey', 'c'), ('church_group_members_profile_id_fkey', 'c'), ('church_group_members_group_fk', 'c'), ('church_group_members_member_fk', 'c'),
                 ('church_leadership_profile_id_fkey', 'c'), ('church_leadership_member_fk', 'c')) x(conname, act)
   where not exists (select 1 from pg_constraint c where c.contype = 'f' and c.conname = x.conname and c.confdeltype = x.act::"char" and c.convalidated);
  if v_bad is not null then raise exception 'postcondition failed: foreign key missing or with the wrong delete action: %', v_bad; end if;

  -- 7c. the child rules exist as constraints
  select string_agg(x.conname, ', ') into v_bad
    from unnest(array['church_members_child_guardian_check', 'church_members_child_minimal_check', 'church_members_adult_no_guardian_check', 'church_members_no_self_guardian_check']) x(conname)
   where not exists (select 1 from pg_constraint c where c.conrelid = 'public.church_members'::regclass and c.contype = 'c' and c.conname = x.conname and c.convalidated);
  if v_bad is not null then raise exception 'postcondition failed: constraint missing: %', v_bad; end if;

  -- 7d. every new trigger exists and is enabled
  select string_agg(x.rel || '.' || x.tgname, ', ') into v_bad
    from (values ('church_members', 'church_tenant_guard_trg'), ('church_groups', 'church_tenant_guard_trg'), ('church_group_members', 'church_tenant_guard_trg'), ('church_leadership', 'church_tenant_guard_trg'),
                 ('church_members', 'church_members_guard_trg'), ('church_members', 'church_members_age_sync_trg'), ('church_groups', 'church_groups_delete_guard_trg'), ('church_group_members', 'church_group_members_guard_trg'), ('church_leadership', 'church_leadership_guard_trg'),
                 ('organization_roles', 'organization_roles_church_guard_trg'), ('organization_members', 'organization_members_church_guard_trg'), ('organization_invitations', 'organization_invitations_church_guard_trg')) x(rel, tgname)
   where not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || x.rel)::regclass and g.tgname = x.tgname and g.tgenabled = 'O' and not g.tgisinternal);
  if v_bad is not null then raise exception 'postcondition failed: trigger missing or disabled: %', v_bad; end if;

  -- 7e. no API role can EXECUTE the guards; anon / PUBLIC can EXECUTE none of the new functions
  select string_agg(distinct p.proname, ', ') into v_bad
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'public'::regnamespace and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))
     and p.proname in ('church_tenant_guard', 'church_members_guard', 'church_group_members_guard', 'church_leadership_guard', 'church_members_age_sync', 'church_groups_delete_guard', 'team_church_permissions', 'team_church_permission_tier',
                       'team_church_change_denied', 'team_role_church_permissions', 'organization_roles_church_guard', 'organization_members_church_guard', 'organization_invitations_church_guard');
  if v_bad is not null then raise exception 'postcondition failed: an API role can EXECUTE: %', v_bad; end if;
  select string_agg(distinct p.proname, ', ') into v_bad
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'public'::regnamespace and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or pg_get_userbyid(a.grantee) = 'anon')
     and p.proname in ('church_is_owner', 'church_has_permission', 'is_church_profile', 'church_is_group_leader', 'church_is_group_member', 'church_member_in_led_group', 'church_member_is_me');
  if v_bad is not null then raise exception 'postcondition failed: anon or PUBLIC can EXECUTE a policy helper: %', v_bad; end if;

  -- 7f. NOTHING EXISTING WAS CHANGED: same row counts, same policies, same pre-existing triggers (still enabled), same definitions of the shared permission helpers
  if (select count(*) from public.profiles) <> (v_pre->>'profiles')::bigint or (select count(*) from public.users) <> (v_pre->>'users')::bigint
     or (select count(*) from public.organization_roles) <> (v_pre->>'org_roles')::bigint or (select count(*) from public.organization_members) <> (v_pre->>'org_members')::bigint
     or (select count(*) from public.organization_invitations) <> (v_pre->>'org_invites')::bigint then
    raise exception 'postcondition failed: a row count of an existing table changed';
  end if;
  if (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
        from pg_policy p where p.polrelid in ('public.organization_roles'::regclass, 'public.organization_members'::regclass, 'public.organization_invitations'::regclass, 'public.profiles'::regclass)) is distinct from v_pre->'org_policies' then
    raise exception 'postcondition failed: the policies on the Team tables or profiles changed';
  end if;
  select string_agg(x, ', ') into v_bad from jsonb_array_elements_text(v_pre->'org_triggers') x
   where not exists (select 1 from pg_trigger g where g.tgrelid::regclass::text || '.' || g.tgname = x and g.tgenabled = 'O' and not g.tgisinternal);
  if v_bad is not null then raise exception 'postcondition failed: an existing trigger is missing or disabled: %', v_bad; end if;
  if (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid))) from pg_proc f where f.pronamespace = 'public'::regnamespace and f.proname in ('is_admin', 'has_org_permission', 'is_org_member'))
       is distinct from v_pre->'fn_defs' then
    raise exception 'postcondition failed: is_admin / has_org_permission / is_org_member changed';
  end if;
end $$;

commit;
