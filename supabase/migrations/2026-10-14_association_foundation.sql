-- ============================================================================
-- ASSOCIATION PROGRAM - PHASE A: FOUNDATION (FINAL - FOR REVIEW, NOT EXECUTED)
--
-- Scope: association_categories, associations, association_staff,
-- ensure_association_for_profile, nullable association_id on the six existing
-- Association tables, safe backfill, sync triggers, reconciliation function,
-- Association-scoped RLS helpers + read policies.
--
-- NOT touched: any existing CHECK/constraint, any existing RLS policy,
-- log_association_earn, log_association_redeem, ringo_cards, notifications,
-- plans, payment_transactions and its commission trigger, Fapshi, Get Started,
-- Team/Organization, is_admin / is_org_* / has_org_permission,
-- handle_new_auth_user and the auth.users trigger, the users referral/
-- affiliate/default-plan triggers, Vercel cron, Stage B.
--
-- AUTHORITY RULE: the legacy association_profile_id stays AUTHORITATIVE.
-- association_id is a DERIVED compatibility link. NOTHING in Phase A reads it
-- for authorization; a NULL association_id therefore grants nothing.
--
-- FK DIRECTION: every FK created here is ON DELETE CASCADE from a PARENT to
-- its dependents (users/profiles -> associations -> staff + Association
-- records). Deleting an associations row deletes only rows that reference it;
-- it can never delete a profile, a user or another Association, because none
-- of those reference it. The only non-cascade FK created is
-- associations.category_id -> association_categories (lookup, never deleted).
--
-- SELF-VERIFYING: one transaction. Preconditions run first, postconditions
-- (including a live-catalog check of every new FK's delete action) run last;
-- any failure RAISEs and the whole migration rolls back.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS + snapshot of "before" numbers (transaction-local setting;
--    creates no object).
-- ----------------------------------------------------------------------------
do $$
declare
  v_missing text;
  v_null_owner bigint;
  v_triggers text;
  v_existing_cols text;
begin
  -- 0a. Required existing objects.
  select string_agg(t, ', ') into v_missing
  from unnest(array[
    'association_members', 'association_partners', 'association_rewards', 'association_settings',
    'association_point_transactions', 'association_invitations', 'profiles', 'users'
  ]) as t
  where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'Phase A precondition failed: missing tables: %', v_missing;
  end if;

  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Phase A precondition failed: public.is_admin() not found';
  end if;

  -- 0b. Unknown-state guard: association_id columns must not pre-exist without
  --     our own tables (would mean a half-applied or foreign change).
  select string_agg(table_name, ', ') into v_existing_cols
  from information_schema.columns
  where table_schema = 'public' and column_name = 'association_id'
    and table_name in ('association_members', 'association_partners', 'association_rewards',
                       'association_settings', 'association_point_transactions', 'association_invitations');
  if v_existing_cols is not null and to_regclass('public.associations') is null then
    raise exception 'Phase A precondition failed: association_id already exists on (%) but public.associations does not', v_existing_cols;
  end if;

  -- 0c. No unknown triggers on the six legacy tables (our own is allowed, so the
  --     migration stays re-runnable). RI/FK triggers are internal and excluded.
  select string_agg(c.relname || '.' || tg.tgname, ', ') into v_triggers
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not tg.tgisinternal
    and c.relname in ('association_members', 'association_partners', 'association_rewards',
                      'association_settings', 'association_point_transactions', 'association_invitations')
    and tg.tgname <> 'trg_sync_association_id';
  if v_triggers is not null then
    raise exception 'Phase A precondition failed: unexpected existing triggers on Association tables: %', v_triggers;
  end if;

  -- 0d. Mapping must be unambiguous: every Association profile has an owner.
  select count(*) into v_null_owner
  from public.profiles p
  where p.user_id is null
    and p.id in (
      select association_profile_id from public.association_settings
      union select association_profile_id from public.association_partners
      union select association_profile_id from public.association_members
      union select association_profile_id from public.association_rewards
      union select association_profile_id from public.association_point_transactions
      union select association_profile_id from public.association_invitations
    );
  if v_null_owner > 0 then
    raise exception 'Phase A precondition failed: % Association profile(s) have no owner user', v_null_owner;
  end if;

  -- 0e. "Before" snapshot for the postconditions.
  perform set_config('assoc_phase_a.pre', jsonb_build_object(
    'members',  (select count(*) from public.association_members),
    'partners', (select count(*) from public.association_partners),
    'rewards',  (select count(*) from public.association_rewards),
    'settings', (select count(*) from public.association_settings),
    'ledger',   (select count(*) from public.association_point_transactions),
    'invites',  (select count(*) from public.association_invitations),
    'balance',  (select coalesce(sum(points_balance), 0) from public.association_members),
    'points',   (select coalesce(sum(points_delta), 0) from public.association_point_transactions),
    'users',    (select count(*) from public.users),
    'profiles', (select count(*) from public.profiles),
    'assoc_profiles', (select count(*) from (
        select association_profile_id from public.association_settings
        union select association_profile_id from public.association_partners
        union select association_profile_id from public.association_members
        union select association_profile_id from public.association_rewards
        union select association_profile_id from public.association_point_transactions
        union select association_profile_id from public.association_invitations
      ) s)
  )::text, true);
end $$;

-- ----------------------------------------------------------------------------
-- 1. association_categories - a lookup, not architecture. Automotive is one
--    seed row; there is no automotive table or column anywhere. name_en /
--    name_fr are bilingual data labels.
-- ----------------------------------------------------------------------------
create table if not exists public.association_categories (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name_en text not null,
  name_fr text not null,
  terminology jsonb not null default '{}'::jsonb,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.association_categories (key, name_en, name_fr, sort_order) values
  ('general',      'General',              'Général',                  0),
  ('automotive',   'Automotive',           'Automobile',              10),
  ('professional', 'Professional',         'Professionnelle',         20),
  ('sports',       'Sports',               'Sportive',                30),
  ('student',      'Student',              'Étudiante',               40),
  ('business',     'Business network',     'Réseau d''affaires',      50),
  ('community',    'Community',            'Communautaire',           60),
  ('cultural',     'Cultural',             'Culturelle',              70),
  ('cooperative',  'Cooperative',          'Coopérative',             80),
  ('trade',        'Trade association',    'Association corporative', 90),
  ('education',    'Education & training', 'Éducation et formation', 100),
  ('other',        'Other',                'Autre',                  110)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 2. associations - the Association identity.
--    Parents (users, profiles) -> associations is CASCADE (demo cleanup flows
--    down from the deleted user). Nothing references a user/profile FROM here
--    in the other direction, so deleting an associations row never touches
--    users or profiles. legacy_profile_id is UNIQUE: the 1:1 mapping to
--    today's profile-keyed data.
-- ----------------------------------------------------------------------------
create table if not exists public.associations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category_id uuid not null references public.association_categories(id),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  host_profile_id uuid not null references public.profiles(id) on delete cascade,
  legacy_profile_id uuid unique references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists associations_owner_user_idx on public.associations (owner_user_id);
create index if not exists associations_host_profile_idx on public.associations (host_profile_id);
create index if not exists associations_category_idx on public.associations (category_id);

-- ----------------------------------------------------------------------------
-- 3. association_staff - Association-scoped roles (NOT Team tables, NOT global
--    admin). super_associate = implicit all permissions in that Association;
--    associate_admin = the strings in `permissions`. granted_by has no FK.
-- ----------------------------------------------------------------------------
create table if not exists public.association_staff (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('super_associate', 'associate_admin')),
  permissions text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'inactive', 'removed')),
  granted_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (association_id, user_id)
);
create index if not exists association_staff_user_idx on public.association_staff (user_id, status);

-- Defense in depth: no client write privilege on the three new tables at all.
revoke all on public.association_categories, public.associations, public.association_staff from public;
revoke all on public.association_categories, public.associations, public.association_staff from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.association_categories, public.associations, public.association_staff from authenticated;

-- ----------------------------------------------------------------------------
-- 4. ensure_association_for_profile(profile) - idempotent, concurrency-safe,
--    with three explicit stages and NO early RETURN of an existing Association:
--      (A) RESOLVE  - use the existing Association if there is one.
--      (B) CREATE   - only when none exists. Every outcome of the INSERT is
--                     handled explicitly (see the inline notes); nothing
--                     EXITs on an unexamined result.
--      (C) OWNER    - the owner's active super_associate staff row is checked
--                     (and inserted/repaired) on EVERY path that reaches here,
--                     including an Association that already existed at (A).
--    * No check-then-insert for the Association itself: INSERT ... ON CONFLICT
--      (legacy_profile_id) DO NOTHING; concurrent callers converge on one row.
--      The check in (C) is only an optimization in front of an ON CONFLICT
--      upsert, so it is race-safe too.
--    * Slug = sanitized username + '-' + prefix of the profile id (8, then 16,
--      then 32 hex chars). The 32-char form contains the whole (unique)
--      profile id.
--    * NEVER raises: any failure emits a WARNING (visible in the Postgres /
--      Supabase logs) and returns NULL; reconcile_association_links()
--      repairs the gap deterministically. Assumes READ COMMITTED (the Supabase
--      default); under a stricter level an invisible conflict row ends in the
--      explicit warning-and-NULL path, never a wrong result.
-- ----------------------------------------------------------------------------
create or replace function public.ensure_association_for_profile(p_profile_id uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_id uuid;
  v_owner uuid;
  v_username text;
  v_name text;
  v_cat uuid;
  v_base text;
  v_slug text;
  v_len int;
  v_slug_retry boolean;
begin
  if p_profile_id is null then
    return null;
  end if;

  -- (A) RESOLVE ---------------------------------------------------------------
  select a.id into v_id from public.associations a where a.legacy_profile_id = p_profile_id;

  -- (B) CREATE (only when none exists) ---------------------------------------------
  if v_id is null then
    select p.user_id, p.username, p.name into v_owner, v_username, v_name
    from public.profiles p where p.id = p_profile_id;
    if v_owner is null then
      raise warning 'ensure_association_for_profile(%): profile missing or has no owner user', p_profile_id;
      return null;
    end if;

    select c.id into v_cat from public.association_categories c where c.key = 'general';
    if v_cat is null then
      raise warning 'ensure_association_for_profile(%): default category "general" missing', p_profile_id;
      return null;
    end if;

    v_base := left(trim(both '-' from regexp_replace(lower(coalesce(v_username, '')), '[^a-z0-9]+', '-', 'g')), 40);
    if v_base = '' then
      v_base := 'association';
    end if;

    foreach v_len in array array[8, 16, 32] loop
      v_slug := v_base || '-' || left(replace(p_profile_id::text, '-', ''), v_len);
      v_slug_retry := false;
      begin
        insert into public.associations (slug, name, category_id, owner_user_id, host_profile_id, legacy_profile_id)
        values (
          v_slug,
          coalesce(nullif(v_name, ''), nullif(v_username, ''), 'Association'),
          v_cat, v_owner, p_profile_id, p_profile_id
        )
        on conflict (legacy_profile_id) do nothing
        returning id into v_id;

        -- Outcome 1: inserted -> v_id is set by RETURNING.
        -- Outcome 2: DO NOTHING (no row returned) -> a concurrent caller already
        --            created this profile's Association: fetch and use it.
        --            If it is somehow not visible to this snapshot, v_id stays
        --            NULL and v_slug_retry stays false: this is NOT a slug
        --            problem, so the loop ends and the explicit failure below
        --            handles it (no blind retry).
        if v_id is null then
          select a.id into v_id from public.associations a where a.legacy_profile_id = p_profile_id;
        end if;
      exception when unique_violation then
        -- Outcome 3: unique violation. legacy_profile_id is the ON CONFLICT
        -- arbiter and cannot raise this, so it is the slug (a different
        -- Association owns that slug). Confirm it was not a concurrent creation
        -- of THIS profile's Association; if it was not, retry with the longer slug.
        select a.id into v_id from public.associations a where a.legacy_profile_id = p_profile_id;
        v_slug_retry := (v_id is null);
      end;

      exit when v_id is not null or not v_slug_retry;
    end loop;

    -- Outcome 4: no Association resolved (all slug lengths exhausted, or an
    -- invisible conflict row). Explicit, logged failure - never a silent one.
    if v_id is null then
      raise warning 'ensure_association_for_profile(%): could not create or find the Association (slug attempts exhausted or conflicting row not visible)', p_profile_id;
      return null;
    end if;
  end if;

  -- (C) OWNER STAFF - runs for newly created AND pre-existing Associations -----------
  --     The owner of record is always an active super_associate: this mirrors
  --     the legacy rule that the profile owner is the Owner (legacy stays
  --     authoritative). An existing row that is missing, inactive/removed, or
  --     demoted is repaired; a correct row causes no write.
  select a.owner_user_id into v_owner from public.associations a where a.id = v_id;
  if not exists (
    select 1 from public.association_staff s
    where s.association_id = v_id and s.user_id = v_owner
      and s.role = 'super_associate' and s.status = 'active'
  ) then
    insert into public.association_staff (association_id, user_id, role)
    values (v_id, v_owner, 'super_associate')
    on conflict (association_id, user_id)
    do update set role = 'super_associate', status = 'active', updated_at = now();
  end if;

  return v_id;
exception when others then
  raise warning 'ensure_association_for_profile(%) failed: % (SQLSTATE %)', p_profile_id, sqlerrm, sqlstate;
  return null;
end;
$$;

revoke all on function public.ensure_association_for_profile(uuid) from public;
revoke all on function public.ensure_association_for_profile(uuid) from anon, authenticated;
grant execute on function public.ensure_association_for_profile(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 5. Compatibility columns: nullable, ON DELETE CASCADE from the Association
--    (never SET NULL - a later phase blocks ledger UPDATEs, and a SET NULL
--    cascade is an UPDATE). Existing columns/constraints/policies untouched.
-- ----------------------------------------------------------------------------
alter table public.association_members            add column if not exists association_id uuid references public.associations(id) on delete cascade;
alter table public.association_partners           add column if not exists association_id uuid references public.associations(id) on delete cascade;
alter table public.association_rewards            add column if not exists association_id uuid references public.associations(id) on delete cascade;
alter table public.association_settings           add column if not exists association_id uuid references public.associations(id) on delete cascade;
alter table public.association_point_transactions add column if not exists association_id uuid references public.associations(id) on delete cascade;
alter table public.association_invitations         add column if not exists association_id uuid references public.associations(id) on delete cascade;

create index if not exists association_members_association_id_idx            on public.association_members (association_id);
create index if not exists association_partners_association_id_idx           on public.association_partners (association_id);
create index if not exists association_rewards_association_id_idx            on public.association_rewards (association_id);
create unique index if not exists association_settings_association_id_uidx   on public.association_settings (association_id);
create index if not exists association_point_transactions_association_id_idx on public.association_point_transactions (association_id);
create index if not exists association_invitations_association_id_idx        on public.association_invitations (association_id);

-- ----------------------------------------------------------------------------
-- 6. Backfill part 1: one Association (+ owner staff row) per legacy profile.
--    Writes only to NEW tables.
-- ----------------------------------------------------------------------------
select public.ensure_association_for_profile(s.pid)
from (
  select association_profile_id as pid from public.association_settings
  union select association_profile_id from public.association_partners
  union select association_profile_id from public.association_members
  union select association_profile_id from public.association_rewards
  union select association_profile_id from public.association_point_transactions
  union select association_profile_id from public.association_invitations
) s;

-- Backfill part 2: set ONLY the new association_id column, via the unambiguous
-- 1:1 legacy_profile_id mapping. No pre-existing column value changes.
update public.association_members x            set association_id = a.id from public.associations a where a.legacy_profile_id = x.association_profile_id and x.association_id is null;
update public.association_partners x           set association_id = a.id from public.associations a where a.legacy_profile_id = x.association_profile_id and x.association_id is null;
update public.association_rewards x            set association_id = a.id from public.associations a where a.legacy_profile_id = x.association_profile_id and x.association_id is null;
update public.association_settings x           set association_id = a.id from public.associations a where a.legacy_profile_id = x.association_profile_id and x.association_id is null;
update public.association_point_transactions x set association_id = a.id from public.associations a where a.legacy_profile_id = x.association_profile_id and x.association_id is null;
update public.association_invitations x        set association_id = a.id from public.associations a where a.legacy_profile_id = x.association_profile_id and x.association_id is null;

-- ----------------------------------------------------------------------------
-- 7. Sync trigger. association_id is DERIVED from the authoritative legacy
--    association_profile_id; any client-supplied value is overwritten, so a
--    hostile Owner cannot point a row at someone else's Association. Fires on
--    INSERT and only on UPDATEs that name association_profile_id or
--    association_id (existing routes that update name/phone/status/balance
--    never fire it).
--    FAIL-OPEN during the compatibility period: on failure the value is NULL
--    (never a client-supplied value), a WARNING is logged, and the legacy
--    statement still succeeds. A NULL grants nothing: no policy, RPC or route
--    reads association_id for authorization in Phase A.
-- ----------------------------------------------------------------------------
create or replace function public.sync_association_id() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_needs boolean;
  v_id uuid;
begin
  if tg_op = 'INSERT' then
    v_needs := true;
  else
    v_needs := new.association_profile_id is distinct from old.association_profile_id
            or new.association_id is distinct from old.association_id;
  end if;

  if v_needs then
    begin
      v_id := public.ensure_association_for_profile(new.association_profile_id);
    exception when others then
      raise warning 'sync_association_id on %: % (SQLSTATE %)', tg_table_name, sqlerrm, sqlstate;
      v_id := null;
    end;
    if v_id is null then
      raise warning 'sync_association_id on %: association_id left NULL for profile %', tg_table_name, new.association_profile_id;
    end if;
    new.association_id := v_id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_association_id() from public;
revoke all on function public.sync_association_id() from anon, authenticated, service_role;

drop trigger if exists trg_sync_association_id on public.association_members;
create trigger trg_sync_association_id before insert or update of association_profile_id, association_id
  on public.association_members for each row execute function public.sync_association_id();
drop trigger if exists trg_sync_association_id on public.association_partners;
create trigger trg_sync_association_id before insert or update of association_profile_id, association_id
  on public.association_partners for each row execute function public.sync_association_id();
drop trigger if exists trg_sync_association_id on public.association_rewards;
create trigger trg_sync_association_id before insert or update of association_profile_id, association_id
  on public.association_rewards for each row execute function public.sync_association_id();
drop trigger if exists trg_sync_association_id on public.association_settings;
create trigger trg_sync_association_id before insert or update of association_profile_id, association_id
  on public.association_settings for each row execute function public.sync_association_id();
drop trigger if exists trg_sync_association_id on public.association_point_transactions;
create trigger trg_sync_association_id before insert or update of association_profile_id, association_id
  on public.association_point_transactions for each row execute function public.sync_association_id();
drop trigger if exists trg_sync_association_id on public.association_invitations;
create trigger trg_sync_association_id before insert or update of association_profile_id, association_id
  on public.association_invitations for each row execute function public.sync_association_id();

-- ----------------------------------------------------------------------------
-- 8. reconcile_association_links(p_repair) - deterministic reconciliation and
--    monitoring. Reports/repairs two kinds of gap:
--      * the six legacy tables: rows whose association_id is NULL;
--      * association_owner_staff: Associations whose owner has no ACTIVE
--        super_associate staff row.
--    p_repair = false: makes NO change (it only runs count queries).
--    p_repair = true : creates missing Associations, fills ONLY NULL
--    association_id values from legacy_profile_id, and inserts/repairs owner
--    staff rows. NOTE: this is a SECURITY DEFINER PL/pgSQL function in BOTH
--    modes; "read-only" describes what the false branch does, not the kind of
--    object it is.
-- ----------------------------------------------------------------------------
create or replace function public.reconcile_association_links(p_repair boolean default false)
returns table (source_table text, gaps_before bigint, repaired bigint, gaps_after bigint)
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_table text;
  v_before bigint;
  v_repaired bigint;
  v_after bigint;
begin
  foreach v_table in array array[
    'association_members', 'association_partners', 'association_rewards',
    'association_settings', 'association_point_transactions', 'association_invitations'
  ] loop
    execute format('select count(*) from public.%I where association_id is null', v_table) into v_before;
    v_repaired := 0;
    if p_repair and v_before > 0 then
      execute format(
        'select public.ensure_association_for_profile(x.pid) from (select distinct association_profile_id as pid from public.%I where association_id is null) x', v_table);
      execute format(
        'update public.%I x set association_id = a.id from public.associations a where a.legacy_profile_id = x.association_profile_id and x.association_id is null', v_table);
      get diagnostics v_repaired = row_count;
    end if;
    execute format('select count(*) from public.%I where association_id is null', v_table) into v_after;
    source_table := v_table; gaps_before := v_before; repaired := v_repaired; gaps_after := v_after;
    return next;
  end loop;

  select count(*) into v_before
  from public.associations assoc
  where not exists (
    select 1 from public.association_staff s
    where s.association_id = assoc.id and s.user_id = assoc.owner_user_id
      and s.role = 'super_associate' and s.status = 'active'
  );
  v_repaired := 0;
  if p_repair and v_before > 0 then
    insert into public.association_staff (association_id, user_id, role)
    select assoc.id, assoc.owner_user_id, 'super_associate'
    from public.associations assoc
    where not exists (
      select 1 from public.association_staff s
      where s.association_id = assoc.id and s.user_id = assoc.owner_user_id
        and s.role = 'super_associate' and s.status = 'active'
    )
    on conflict (association_id, user_id)
    do update set role = 'super_associate', status = 'active', updated_at = now();
    get diagnostics v_repaired = row_count;
  end if;
  select count(*) into v_after
  from public.associations assoc
  where not exists (
    select 1 from public.association_staff s
    where s.association_id = assoc.id and s.user_id = assoc.owner_user_id
      and s.role = 'super_associate' and s.status = 'active'
  );
  source_table := 'association_owner_staff'; gaps_before := v_before; repaired := v_repaired; gaps_after := v_after;
  return next;
end;
$$;

revoke all on function public.reconcile_association_links(boolean) from public;
revoke all on function public.reconcile_association_links(boolean) from anon, authenticated;
grant execute on function public.reconcile_association_links(boolean) to service_role;

-- ----------------------------------------------------------------------------
-- 9. RLS helpers (new names; existing is_association_* untouched). Policy
--    expressions run with the caller's privileges, so these are executable by
--    `authenticated` (and service_role) - never by anon or PUBLIC.
-- ----------------------------------------------------------------------------
create or replace function public.association_staff_role(p_association_id uuid) returns text
language sql security definer stable set search_path = pg_catalog, public, pg_temp as $$
  select s.role
  from public.association_staff s
  where s.association_id = p_association_id
    and s.user_id = auth.uid()
    and s.status = 'active'
  limit 1;
$$;

create or replace function public.has_association_permission(p_association_id uuid, p_permission text) returns boolean
language sql security definer stable set search_path = pg_catalog, public, pg_temp as $$
  select exists (
    select 1
    from public.association_staff s
    where s.association_id = p_association_id
      and s.user_id = auth.uid()
      and s.status = 'active'
      and (s.role = 'super_associate' or p_permission = any(s.permissions))
  );
$$;

revoke all on function public.association_staff_role(uuid) from public;
revoke all on function public.association_staff_role(uuid) from anon;
revoke all on function public.has_association_permission(uuid, text) from public;
revoke all on function public.has_association_permission(uuid, text) from anon;
grant execute on function public.association_staff_role(uuid) to authenticated, service_role;
grant execute on function public.has_association_permission(uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 10. RLS - SELECT policies only, authenticated only. No client insert/update/
--     delete policy exists on any new table (privileges also revoked in step 3).
--     is_admin() is used for support VISIBILITY only, matching the existing
--     Association policies; it grants no Association role and no write access.
-- ----------------------------------------------------------------------------
alter table public.association_categories enable row level security;
alter table public.associations enable row level security;
alter table public.association_staff enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'association_categories' and policyname = 'association_categories read') then
    create policy "association_categories read" on public.association_categories
      for select to authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'associations' and policyname = 'associations read') then
    create policy "associations read" on public.associations
      for select to authenticated using (
        owner_user_id = auth.uid()
        or public.association_staff_role(id) is not null
        or public.is_admin()
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'association_staff' and policyname = 'association_staff read') then
    create policy "association_staff read" on public.association_staff
      for select to authenticated using (
        user_id = auth.uid()
        or public.has_association_permission(association_id, 'staff.manage')
        or public.is_admin()
      );
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 11. POSTCONDITIONS - any failure RAISEs and rolls the entire migration back.
-- ----------------------------------------------------------------------------
do $$
declare
  pre jsonb := current_setting('assoc_phase_a.pre')::jsonb;
  v_gaps bigint;
  v_bad bigint;
  v_fk text;
begin
  -- Existing data untouched.
  if (select count(*) from public.association_members)            <> (pre->>'members')::bigint  then raise exception 'Postcondition: association_members count changed'; end if;
  if (select count(*) from public.association_partners)           <> (pre->>'partners')::bigint then raise exception 'Postcondition: association_partners count changed'; end if;
  if (select count(*) from public.association_rewards)            <> (pre->>'rewards')::bigint  then raise exception 'Postcondition: association_rewards count changed'; end if;
  if (select count(*) from public.association_settings)           <> (pre->>'settings')::bigint then raise exception 'Postcondition: association_settings count changed'; end if;
  if (select count(*) from public.association_point_transactions) <> (pre->>'ledger')::bigint   then raise exception 'Postcondition: ledger count changed'; end if;
  if (select count(*) from public.association_invitations)        <> (pre->>'invites')::bigint  then raise exception 'Postcondition: association_invitations count changed'; end if;
  if (select count(*) from public.users)                          <> (pre->>'users')::bigint    then raise exception 'Postcondition: users count changed'; end if;
  if (select count(*) from public.profiles)                       <> (pre->>'profiles')::bigint then raise exception 'Postcondition: profiles count changed'; end if;

  if (select coalesce(sum(points_balance), 0) from public.association_members)          <> (pre->>'balance')::bigint then raise exception 'Postcondition: total points_balance changed'; end if;
  if (select coalesce(sum(points_delta), 0) from public.association_point_transactions) <> (pre->>'points')::bigint  then raise exception 'Postcondition: total ledger points changed'; end if;

  -- New structures populated as expected.
  if (select count(*) from public.associations) <> (pre->>'assoc_profiles')::bigint then
    raise exception 'Postcondition: associations count (%) <> distinct Association profiles (%)',
      (select count(*) from public.associations), pre->>'assoc_profiles';
  end if;
  if (select count(*) from public.association_staff where role = 'super_associate') <> (pre->>'assoc_profiles')::bigint then
    raise exception 'Postcondition: super_associate staff rows <> Associations';
  end if;
  -- (Owner-staff gaps - including an owner whose row is inactive or demoted - are
  --  also covered by the reconcile_association_links(false) gap sum below.)

  -- Backfill complete and unambiguous (this sum also asserts every Association's
  -- owner has an active super_associate staff row).
  select coalesce(sum(gaps_after), 0) into v_gaps from public.reconcile_association_links(false);
  if v_gaps <> 0 then
    raise exception 'Postcondition: % row(s) still have association_id NULL', v_gaps;
  end if;

  select
      (select count(*) from public.association_members x            join public.associations a on a.id = x.association_id where a.legacy_profile_id is distinct from x.association_profile_id)
    + (select count(*) from public.association_partners x           join public.associations a on a.id = x.association_id where a.legacy_profile_id is distinct from x.association_profile_id)
    + (select count(*) from public.association_rewards x            join public.associations a on a.id = x.association_id where a.legacy_profile_id is distinct from x.association_profile_id)
    + (select count(*) from public.association_settings x           join public.associations a on a.id = x.association_id where a.legacy_profile_id is distinct from x.association_profile_id)
    + (select count(*) from public.association_point_transactions x join public.associations a on a.id = x.association_id where a.legacy_profile_id is distinct from x.association_profile_id)
    + (select count(*) from public.association_invitations x        join public.associations a on a.id = x.association_id where a.legacy_profile_id is distinct from x.association_profile_id)
  into v_bad;
  if v_bad <> 0 then
    raise exception 'Postcondition: % row(s) mapped to the wrong Association', v_bad;
  end if;

  -- LIVE-CATALOG cascade check, no assumptions:
  -- (a) every FK that references public.associations is ON DELETE CASCADE, so
  --     deleting an Association only ever deletes its own dependents;
  select string_agg(con.conrelid::regclass::text || '.' || con.conname, ', ') into v_fk
  from pg_constraint con
  where con.contype = 'f'
    and con.confrelid = 'public.associations'::regclass
    and con.confdeltype <> 'c';
  if v_fk is not null then
    raise exception 'Postcondition: non-cascade FK(s) reference associations: %', v_fk;
  end if;

  -- (b) every FK from associations / association_staff to users or profiles is
  --     ON DELETE CASCADE (demo cleanup can never be blocked by a new FK);
  select string_agg(con.conrelid::regclass::text || '.' || con.conname, ', ') into v_fk
  from pg_constraint con
  where con.contype = 'f'
    and con.conrelid in ('public.associations'::regclass, 'public.association_staff'::regclass)
    and con.confrelid in ('public.users'::regclass, 'public.profiles'::regclass)
    and con.confdeltype <> 'c';
  if v_fk is not null then
    raise exception 'Postcondition: non-cascade FK(s) to users/profiles: %', v_fk;
  end if;

  -- (c) nothing that exists outside Phase A references associations, so no
  --     existing table can be reached by (or block) an Association delete.
  select string_agg(con.conrelid::regclass::text || '.' || con.conname, ', ') into v_fk
  from pg_constraint con
  where con.contype = 'f'
    and con.confrelid = 'public.associations'::regclass
    and con.conrelid::regclass::text not in (
      'association_staff', 'association_members', 'association_partners', 'association_rewards',
      'association_settings', 'association_point_transactions', 'association_invitations'
    );
  if v_fk is not null then
    raise exception 'Postcondition: unexpected table(s) reference associations: %', v_fk;
  end if;
end $$;

commit;
