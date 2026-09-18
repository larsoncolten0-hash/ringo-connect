-- ============================================================================
-- ASSOCIATION PROGRAM - PHASE B1: MEMBERSHIP CORE
--
-- Adds (all additive):
--   * association_membership_plans, association_memberships, association_audit_log
--   * association_memberships_effective (read-only view, service_role only)
--   * association_members.lifecycle_state / lifecycle_changed_at + guards
--   * associations.membership_seq (race-safe membership numbers)
--   * 11 narrow SECURITY DEFINER RPCs (service_role only) + private helpers
--
-- B1 ONLY. No cards, no notifications, no scheduler/cron, no payment engine and
-- NO payment_status column: nothing here can be mistaken for payment confirmation.
--
-- NOT touched: log_association_earn / log_association_redeem (bodies and grants),
-- any existing RLS policy, any existing table privilege, ringo_cards, notifications,
-- payment_transactions / Fapshi, Team, auth, Get Started, Vercel cron.
--
-- LEGACY COMPATIBILITY
--   * association_profile_id stays authoritative. Members with lifecycle_state IS NULL
--     (all 9 today) behave exactly as before: no B1 rule touches them.
--   * Once lifecycle_state is non-NULL it is authoritative and legacy `status` is only
--     a projection of it (active -> active; pending/suspended/expired/cancelled ->
--     disabled). A legacy status change on a managed member is REJECTED
--     ('membership_managed'); lifecycle can never return to NULL.
--   * lifecycle_state can only be changed while current_user is the OWNER of
--     association_members. That identity is held by (a) the SECURITY DEFINER RPCs below
--     and (b) any direct database session that logs in as that owner (SQL editor,
--     migration). It is NOT held by anon / authenticated / service_role / authenticator:
--     this migration aborts unless none of them is, or can become, the owner
--     (pg_has_role MEMBER). No marker or GUC exists to spoof. The rule therefore rests on
--     the owner role's credentials and on no API role being a member of that role, which
--     is verified at migration time and again in the postconditions. A direct owner-role
--     session is trusted by design.
--   * Benefits (MANAGED members only, lifecycle_state IS NOT NULL): the stored balance may
--     change only when BOTH hold: (1) the write runs as the table owner, i.e. from a
--     SECURITY DEFINER function such as the unchanged log_association_earn /
--     log_association_redeem (a direct PostgREST UPDATE by an Owner, or a service_role
--     UPDATE, runs as authenticated / service_role and is refused), and (2) the member's
--     term is EFFECTIVELY active (one SQL function, database clock only; no sweep needed).
--     Any other definer function owned by that role that writes points_balance would also
--     pass (1); the live writer inventory found only earn and redeem.
--   * NOT CLOSED BY B1 (pre-existing, deliberately out of scope, unchanged): LEGACY members
--     (lifecycle_state IS NULL) can still have points_balance written directly by their
--     Owner (the "association_members owner all" RLS policy plus the table UPDATE grant)
--     or by service_role. B1 changes no existing policy or privilege, so it does not
--     claim to close that path. It only guarantees the two rules above for managed members.
--
-- The migration is one transaction: any failed precondition or postcondition RAISEs
-- and rolls everything back. It is NOT re-runnable by design (it aborts if any B1
-- object already exists).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS + snapshot of the "before" state
-- ----------------------------------------------------------------------------
do $$
declare
  v_missing text;
  v_n bigint;
  v_txt text;
  v_owner text;
  v_six text[] := array['association_members', 'association_partners', 'association_rewards',
                        'association_settings', 'association_point_transactions', 'association_invitations'];
begin
  -- 0a. Phase A objects exist
  select string_agg(t, ', ') into v_missing
  from unnest(array['associations', 'association_staff', 'association_categories', 'association_members',
                    'association_partners', 'association_rewards', 'association_settings',
                    'association_point_transactions', 'association_invitations', 'profiles', 'users']) as t
  where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'B1 precondition failed: missing tables: %', v_missing;
  end if;

  select string_agg(f, ', ') into v_missing
  from unnest(array['ensure_association_for_profile', 'sync_association_id', 'reconcile_association_links',
                    'association_staff_role', 'has_association_permission',
                    'log_association_earn', 'log_association_redeem']) as f
  where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f);
  if v_missing is not null then
    raise exception 'B1 precondition failed: missing functions: %', v_missing;
  end if;

  select count(*) into v_n
  from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
  where c.relnamespace = 'public'::regnamespace and c.relname = any(v_six)
    and tg.tgname = 'trg_sync_association_id' and not tg.tgisinternal;
  if v_n <> 6 then
    raise exception 'B1 precondition failed: expected 6 trg_sync_association_id triggers, found %', v_n;
  end if;

  -- 0b. Phase A reconciliation is clean and every mapping is valid
  select coalesce(sum(gaps_after), 0) into v_n from public.reconcile_association_links(false);
  if v_n <> 0 then
    raise exception 'B1 precondition failed: reconcile_association_links reports % gap(s)', v_n;
  end if;

  select
      (select count(*) from public.association_members x join public.associations a on a.id = x.association_id where a.legacy_profile_id is distinct from x.association_profile_id)
    + (select count(*) from public.association_partners x join public.associations a on a.id = x.association_id where a.legacy_profile_id is distinct from x.association_profile_id)
    + (select count(*) from public.association_rewards x join public.associations a on a.id = x.association_id where a.legacy_profile_id is distinct from x.association_profile_id)
    + (select count(*) from public.association_settings x join public.associations a on a.id = x.association_id where a.legacy_profile_id is distinct from x.association_profile_id)
    + (select count(*) from public.association_point_transactions x join public.associations a on a.id = x.association_id where a.legacy_profile_id is distinct from x.association_profile_id)
    + (select count(*) from public.association_invitations x join public.associations a on a.id = x.association_id where a.legacy_profile_id is distinct from x.association_profile_id)
  into v_n;
  if v_n <> 0 then
    raise exception 'B1 precondition failed: % row(s) mapped to the wrong Association', v_n;
  end if;

  -- 0c. No B1 object exists yet (B1 is deliberately not re-runnable)
  select string_agg(x, ', ') into v_missing from (
    select 'table ' || t as x from unnest(array['association_membership_plans', 'association_memberships', 'association_audit_log']) as t
      where to_regclass('public.' || t) is not null
    union all select 'view association_memberships_effective' where to_regclass('public.association_memberships_effective') is not null
    union all select 'column association_members.' || column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'association_members' and column_name in ('lifecycle_state', 'lifecycle_changed_at')
    union all select 'column associations.membership_seq' from information_schema.columns
      where table_schema = 'public' and table_name = 'associations' and column_name = 'membership_seq'
    union all select 'index association_members_id_association_id_uidx' from pg_class
      where relnamespace = 'public'::regnamespace and relname = 'association_members_id_association_id_uidx'
    union all select 'function ' || p.proname from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = any(array[
        'association_update_membership_settings', 'association_create_plan', 'association_update_plan',
        'association_set_plan_active', 'association_start_membership', 'association_activate_membership',
        'association_suspend_membership', 'association_reinstate_membership', 'association_renew_membership',
        'association_cancel_membership', 'association_expire_memberships', 'association_membership_effective_state',
        'association_members_lifecycle_guard', 'association_members_points_guard',
        'association_memberships_insert_guard', 'association_memberships_update_guard', 'association_audit_block_update',
        '_assoc_actor_can', '_assoc_membership_enabled', '_assoc_audit', '_assoc_materialize_expiry'])
    union all select 'trigger ' || tg.tgname from pg_trigger tg
      where not tg.tgisinternal and tg.tgname in ('trg_association_members_lifecycle', 'trg_association_members_points_guard')
  ) z;
  if v_missing is not null then
    raise exception 'B1 precondition failed: B1 objects already exist: %', v_missing;
  end if;

  -- 0d. Association config is a JSON object everywhere
  select count(*) into v_n from public.associations where jsonb_typeof(config) is distinct from 'object';
  if v_n <> 0 then
    raise exception 'B1 precondition failed: % Association(s) have a non-object config', v_n;
  end if;

  -- 0e. Trigger state matches the verified Phase A baseline
  select string_agg(tg.tgname, ', ') into v_txt from pg_trigger tg
  where tg.tgrelid = 'public.association_members'::regclass and not tg.tgisinternal and tg.tgname <> 'trg_sync_association_id';
  if v_txt is not null then
    raise exception 'B1 precondition failed: unexpected triggers on association_members: %', v_txt;
  end if;
  select count(*) into v_n from pg_trigger where tgrelid = 'public.associations'::regclass and not tgisinternal;
  if v_n <> 0 then
    raise exception 'B1 precondition failed: unexpected triggers on associations';
  end if;

  -- 0f. Points integrity
  select count(*) into v_n from (
    select m.id from public.association_members m
    left join public.association_point_transactions t on t.member_id = m.id
    group by m.id, m.points_balance
    having m.points_balance <> coalesce(sum(t.points_delta), 0)) d;
  if v_n <> 0 then
    raise exception 'B1 precondition failed: % member(s) whose balance differs from their ledger', v_n;
  end if;
  if coalesce((select sum(points_balance) from public.association_members), 0)
     <> coalesce((select sum(points_delta) from public.association_point_transactions), 0) then
    raise exception 'B1 precondition failed: total balance differs from total ledger';
  end if;

  -- 0g. The protected earn/redeem RPCs are in the expected state (no exception handler that would
  --     swallow a guard error, definer with pinned search_path, no anon/authenticated/PUBLIC execute)
  select count(*) into v_n from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname in ('log_association_earn', 'log_association_redeem')
    and p.prosecdef and p.proconfig::text like '%search_path=public%' and position('exception' in lower(p.prosrc)) = 0;
  if v_n <> 2 then
    raise exception 'B1 precondition failed: log_association_earn/redeem are not in the expected state';
  end if;
  select count(*) into v_n from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.pronamespace = 'public'::regnamespace and p.proname in ('log_association_earn', 'log_association_redeem')
    and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'));
  if v_n <> 0 then
    raise exception 'B1 precondition failed: earn/redeem are executable by PUBLIC/anon/authenticated';
  end if;

  -- 0h. association_members compatibility: PK on id, status CHECK, valid statuses, run as the table owner
  select count(*) into v_n from pg_constraint c
  where c.conrelid = 'public.association_members'::regclass and c.contype = 'p'
    and (select array_agg(a.attname::text) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) = array['id'];
  if v_n <> 1 then
    raise exception 'B1 precondition failed: association_members has no primary key on (id)';
  end if;
  select count(*) into v_n from pg_constraint c
  where c.conrelid = 'public.association_members'::regclass and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%status%' and pg_get_constraintdef(c.oid) like '%active%' and pg_get_constraintdef(c.oid) like '%disabled%';
  if v_n < 1 then
    raise exception 'B1 precondition failed: association_members.status CHECK (active/disabled) not found';
  end if;
  select count(*) into v_n from public.association_members where status not in ('active', 'disabled');
  if v_n <> 0 then
    raise exception 'B1 precondition failed: % member(s) with an unexpected status', v_n;
  end if;
  select pg_get_userbyid(relowner) into v_owner from pg_class where oid = 'public.association_members'::regclass;
  if v_owner is distinct from current_user::text then
    raise exception 'B1 precondition failed: run this migration as the table owner (% owns association_members, current user is %)', v_owner, current_user;
  end if;

  -- 0h2. Owner-identity trust. The lifecycle and points guards treat "current_user = table owner" as internal.
  --      That is only sound if no API role is, or can become, that owner, and if the protected earn/redeem
  --      definer functions are owned by that same role (so their writes keep working).
  select string_agg(r.rolname::text, ', ') into v_txt from pg_roles r
  where r.rolname in ('anon', 'authenticated', 'service_role', 'authenticator')
    and (r.rolname::text = v_owner or pg_has_role(r.rolname::text, v_owner, 'MEMBER'));
  if v_txt is not null then
    raise exception 'B1 precondition failed: API role(s) % are, or can become, the table owner %', v_txt, v_owner;
  end if;
  select string_agg(p.proname || ' (owner ' || pg_get_userbyid(p.proowner) || ')', ', ') into v_txt from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname in ('log_association_earn', 'log_association_redeem')
    and pg_get_userbyid(p.proowner) is distinct from v_owner;
  if v_txt is not null then
    raise exception 'B1 precondition failed: earn/redeem must be owned by the table owner %: %', v_owner, v_txt;
  end if;

  -- 0i. Snapshot for the postconditions
  perform set_config('assoc_b1.pre', jsonb_build_object(
    'members',  (select count(*) from public.association_members),
    'partners', (select count(*) from public.association_partners),
    'rewards',  (select count(*) from public.association_rewards),
    'settings', (select count(*) from public.association_settings),
    'ledger',   (select count(*) from public.association_point_transactions),
    'invites',  (select count(*) from public.association_invitations),
    'associations', (select count(*) from public.associations),
    'balance',  (select coalesce(sum(points_balance), 0) from public.association_members),
    'points',   (select coalesce(sum(points_delta), 0) from public.association_point_transactions),
    'members_active',   (select count(*) from public.association_members where status = 'active'),
    'members_disabled', (select count(*) from public.association_members where status = 'disabled'),
    'users',    (select count(*) from public.users),
    'profiles', (select count(*) from public.profiles),
    'config_md5', (select md5(coalesce(string_agg(id::text || config::text, '|' order by id), '')) from public.associations),
    'earn_md5',   (select md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'log_association_earn'),
    'redeem_md5', (select md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'log_association_redeem'),
    'policies_md5', (select md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' order by tablename, policyname), ''))
                     from pg_policies where schemaname = 'public' and tablename = any(v_six)),
    'legacy_acl_md5', (select md5(coalesce(string_agg(c.relname || '=' || coalesce(c.relacl::text, ''), '|' order by c.relname), ''))
                       from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any(v_six))
  )::text, true);
end $$;

-- ----------------------------------------------------------------------------
-- 1. Existing tables: additive columns, CHECKs and the composite-FK target index
-- ----------------------------------------------------------------------------
alter table public.association_members
  add column lifecycle_state text,
  add column lifecycle_changed_at timestamptz;

alter table public.association_members
  add constraint association_members_lifecycle_state_check
    check (lifecycle_state is null or lifecycle_state in ('pending', 'active', 'suspended', 'expired', 'cancelled')),
  add constraint association_members_lifecycle_status_check
    check (lifecycle_state is null or status = case when lifecycle_state = 'active' then 'active' else 'disabled' end);

-- Needed so association_memberships can reference (member, Association) as one key. id is already
-- the primary key, so this can never conflict; a NULL association_id can never be referenced.
create unique index association_members_id_association_id_uidx on public.association_members (id, association_id);

alter table public.associations
  add column membership_seq bigint not null default 0 check (membership_seq >= 0);

-- ----------------------------------------------------------------------------
-- 2. association_membership_plans - configuration only. price_amount is NEVER proof of payment.
-- ----------------------------------------------------------------------------
create table public.association_membership_plans (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete cascade,
  name_en text not null,
  name_fr text not null,
  description_en text,
  description_fr text,
  price_amount numeric(12, 2) not null default 0,
  currency text not null default 'XAF',
  duration_months int,
  grace_days int not null default 0,
  active boolean not null default true,
  sort_order int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint association_membership_plans_id_association_uk unique (id, association_id),
  constraint association_membership_plans_name_en_check check (length(btrim(name_en)) between 1 and 80),
  constraint association_membership_plans_name_fr_check check (length(btrim(name_fr)) between 1 and 80),
  constraint association_membership_plans_description_check check (
    (description_en is null) = (description_fr is null)
    and (description_en is null or length(description_en) <= 500)
    and (description_fr is null or length(description_fr) <= 500)),
  constraint association_membership_plans_price_check check (price_amount >= 0),
  constraint association_membership_plans_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint association_membership_plans_duration_check check (duration_months is null or duration_months between 1 and 120),
  constraint association_membership_plans_grace_check check (grace_days between 0 and 365)
);
create index association_membership_plans_assoc_idx on public.association_membership_plans (association_id, active, sort_order);

-- ----------------------------------------------------------------------------
-- 3. association_memberships - one immutable historical term per row.
--    plan_id uses NO ACTION, DEFERRED: deleting a plan can never erase historical terms, while an
--    Association / user cascade delete (which removes plans and memberships in one transaction) still
--    succeeds because the check runs at commit, after every cascade has completed.
-- ----------------------------------------------------------------------------
create table public.association_memberships (
  id uuid primary key default gen_random_uuid(),
  association_id uuid not null,
  member_id uuid not null,
  plan_id uuid not null,
  membership_number text not null,
  state text not null,
  starts_at timestamptz not null,
  expires_at timestamptz,
  grace_days int not null,
  price_amount numeric(12, 2) not null,
  currency text not null,
  activated_at timestamptz,
  renewed_from uuid,
  state_reason text,
  ended_at timestamptz,
  ended_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint association_memberships_id_association_uk unique (id, association_id),
  constraint association_memberships_association_fk foreign key (association_id)
    references public.associations(id) on delete cascade,
  constraint association_memberships_member_fk foreign key (member_id, association_id)
    references public.association_members(id, association_id) on delete cascade,
  constraint association_memberships_plan_fk foreign key (plan_id, association_id)
    references public.association_membership_plans(id, association_id) on delete no action deferrable initially deferred,
  constraint association_memberships_renewed_from_fk foreign key (renewed_from, association_id)
    references public.association_memberships(id, association_id) on delete no action deferrable initially deferred,
  constraint association_memberships_state_check check (state in ('pending', 'active', 'suspended', 'expired', 'cancelled')),
  constraint association_memberships_number_check check (membership_number ~ '^[A-Z0-9]{1,8}-[0-9]{6,12}$'),
  constraint association_memberships_dates_check check (expires_at is null or expires_at > starts_at),
  constraint association_memberships_price_check check (price_amount >= 0),
  constraint association_memberships_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint association_memberships_grace_check check (grace_days between 0 and 365),
  constraint association_memberships_ended_check check (
    (state in ('expired', 'cancelled')) = (ended_at is not null and ended_reason is not null)
    and (ended_at is null) = (ended_reason is null)),
  constraint association_memberships_ended_reason_check check (
    ended_reason is null
    or (state = 'expired' and ended_reason in ('lapsed', 'renewed'))
    or (state = 'cancelled' and ended_reason = 'cancelled')),
  constraint association_memberships_activated_check check (
    (state = 'pending' and activated_at is null)
    or (state in ('active', 'suspended', 'expired') and activated_at is not null)
    or state = 'cancelled'),
  constraint association_memberships_renewed_self_check check (renewed_from is null or renewed_from <> id),
  constraint association_memberships_reason_check check (state_reason is null or length(state_reason) <= 300)
);
-- exactly ONE current term per member
create unique index association_memberships_one_current_uidx on public.association_memberships (member_id)
  where state in ('pending', 'active', 'suspended');
-- a term can be renewed at most once
create unique index association_memberships_renewed_from_uidx on public.association_memberships (renewed_from)
  where renewed_from is not null;
-- numbers are unique per Association across lineages (renewals share their ancestor's number)
create unique index association_memberships_number_root_uidx on public.association_memberships (association_id, membership_number)
  where renewed_from is null;
create index association_memberships_assoc_state_idx on public.association_memberships (association_id, state);
create index association_memberships_member_idx on public.association_memberships (member_id, created_at desc);
create index association_memberships_expiry_idx on public.association_memberships (expires_at)
  where state in ('active', 'suspended') and expires_at is not null;

-- ----------------------------------------------------------------------------
-- 4. association_audit_log - append-only. actor_user_id / member_id have NO foreign key on purpose.
--    Rows are written only by the RPCs from allow-listed columns; no tokens or secrets exist here.
-- ----------------------------------------------------------------------------
create table public.association_audit_log (
  id bigint generated always as identity primary key,
  association_id uuid not null references public.associations(id) on delete cascade,
  actor_user_id uuid,
  actor_kind text not null check (actor_kind in ('staff', 'system')),
  actor_role text,
  action text not null check (length(action) between 1 and 64),
  target_type text not null check (target_type in ('membership', 'plan', 'association_settings')),
  target_id uuid not null,
  member_id uuid,
  changes jsonb not null default '{}'::jsonb check (octet_length(changes::text) <= 8000),
  metadata jsonb not null default '{}'::jsonb check (octet_length(metadata::text) <= 4000),
  created_at timestamptz not null default now()
);
create index association_audit_log_assoc_idx on public.association_audit_log (association_id, id desc);
create index association_audit_log_target_idx on public.association_audit_log (association_id, target_type, target_id);
create index association_audit_log_member_idx on public.association_audit_log (association_id, member_id);

-- ----------------------------------------------------------------------------
-- 5. The single source of truth for EFFECTIVE membership state. Inputs: the stored row and the
--    database clock only (no client-supplied time). Only effective 'active' is benefit-eligible.
--    A term whose end (expires_at + grace) has passed is 'expired' even if no sweep has run.
--    'pending' is never benefit-eligible, even once its start date has passed. 24h units keep the
--    result independent of the session time zone.
-- ----------------------------------------------------------------------------
create function public.association_membership_effective_state(m public.association_memberships) returns text
language sql stable set search_path = pg_catalog, public, pg_temp as $$
  select case
    when m.state in ('active', 'suspended') and m.expires_at is not null
         and now() >= m.expires_at + make_interval(hours => m.grace_days * 24) then 'expired'
    else m.state
  end;
$$;

create view public.association_memberships_effective as
  select m.*, public.association_membership_effective_state(m) as effective_state
  from public.association_memberships m;

-- ----------------------------------------------------------------------------
-- 6. Private helpers. Not executable by any API role (revoked below); callable only from the
--    SECURITY DEFINER RPCs, which run as the table owner.
-- ----------------------------------------------------------------------------
create function public._assoc_actor_can(p_association_id uuid, p_actor uuid, p_perm text) returns boolean
language sql stable set search_path = pg_catalog, public, pg_temp as $$
  select p_actor is not null and exists (
    select 1 from public.association_staff s
    where s.association_id = p_association_id and s.user_id = p_actor and s.status = 'active'
      and (s.role = 'super_associate'
           or p_perm = any(s.permissions)
           or (p_perm = 'memberships.view' and 'memberships.manage' = any(s.permissions))));
$$;

create function public._assoc_membership_enabled(p_association_id uuid) returns boolean
language sql stable set search_path = pg_catalog, public, pg_temp as $$
  select coalesce((select a.config -> 'membership_enabled' = 'true'::jsonb from public.associations a where a.id = p_association_id), false);
$$;

create function public._assoc_audit(p_association_id uuid, p_actor uuid, p_action text, p_target_type text,
                                    p_target_id uuid, p_member_id uuid, p_changes jsonb, p_metadata jsonb) returns void
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  v_role text;
begin
  if p_actor is not null then
    select s.role into v_role from public.association_staff s
    where s.association_id = p_association_id and s.user_id = p_actor and s.status = 'active';
  end if;
  insert into public.association_audit_log (association_id, actor_user_id, actor_kind, actor_role, action,
                                            target_type, target_id, member_id, changes, metadata)
  values (p_association_id, p_actor, case when p_actor is null then 'system' else 'staff' end, v_role, p_action,
          p_target_type, p_target_id, p_member_id, coalesce(p_changes, '{}'::jsonb), coalesce(p_metadata, '{}'::jsonb));
end;
$$;

-- Turns a stored-active/suspended term whose end has passed into 'expired' (lapsed). Called under the
-- member lock. Returns true when it changed something. Never raises for "nothing to do".
create function public._assoc_materialize_expiry(p_membership_id uuid, p_trigger_actor uuid default null) returns boolean
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  m public.association_memberships;
begin
  select * into m from public.association_memberships where id = p_membership_id for update;
  if not found then
    return false;
  end if;
  if m.state not in ('active', 'suspended') or public.association_membership_effective_state(m) <> 'expired' then
    return false;
  end if;
  update public.association_memberships
     set state = 'expired', ended_reason = 'lapsed',
         ended_at = m.expires_at + make_interval(hours => m.grace_days * 24), updated_at = now()
   where id = m.id;
  update public.association_members set lifecycle_state = 'expired'
   where id = m.member_id and lifecycle_state is distinct from 'expired';
  perform public._assoc_audit(m.association_id, null, 'membership.expired', 'membership', m.id, m.member_id,
    jsonb_build_object('state', jsonb_build_object('from', m.state, 'to', 'expired')),
    jsonb_build_object('ended_reason', 'lapsed', 'triggered_by', p_trigger_actor));
  return true;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Guard triggers
-- ----------------------------------------------------------------------------
-- 7a. association_members lifecycle. Legacy members (lifecycle_state NULL) are untouched by every rule.
create function public.association_members_lifecycle_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  v_internal boolean;
begin
  if tg_op = 'INSERT' then
    if new.lifecycle_state is not null or new.lifecycle_changed_at is not null then
      raise exception 'lifecycle_write_denied' using errcode = '42501';
    end if;
    return new;
  end if;

  -- "internal" = executing as the owner of the table, i.e. inside the SECURITY DEFINER membership RPCs
  -- (or a direct owner session). API clients run as anon / authenticated / service_role and can never
  -- take this identity, so there is no marker or setting for them to spoof.
  v_internal := current_user::text = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = tg_relid);

  if (new.lifecycle_state is distinct from old.lifecycle_state
      or new.lifecycle_changed_at is distinct from old.lifecycle_changed_at) and not v_internal then
    raise exception 'lifecycle_write_denied' using errcode = '42501';
  end if;

  if old.lifecycle_state is not null and new.lifecycle_state is null then
    raise exception 'lifecycle_unmanage_denied';
  end if;

  if new.lifecycle_state is distinct from old.lifecycle_state then
    -- status is only a projection of the managed lifecycle
    new.status := case when new.lifecycle_state = 'active' then 'active' else 'disabled' end;
    new.lifecycle_changed_at := now();
  elsif old.lifecycle_state is not null and new.status is distinct from old.status then
    raise exception 'membership_managed';
  end if;
  return new;
end;
$$;

-- 7b. Benefit protection. Fires only for MANAGED members and only when the balance actually changes.
--     A change is allowed only if BOTH: (1) it runs as the table owner, i.e. from a SECURITY DEFINER function
--     such as the unchanged earn/redeem RPCs (a direct client UPDATE runs as authenticated / service_role and
--     is refused), and (2) the member's ACTIVE term is effectively active. This function is deliberately
--     SECURITY INVOKER: were it SECURITY DEFINER, current_user would always be the owner and (1) would be void.
--     No bypass, no setting, no allow-list. Legacy members (lifecycle_state NULL) never reach this trigger.
create function public.association_members_points_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  t public.association_memberships;
begin
  if current_user::text is distinct from (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = tg_relid) then
    raise exception 'points_write_denied' using errcode = '42501';
  end if;
  select * into t from public.association_memberships where member_id = new.id and state = 'active' limit 1;
  if not found or old.lifecycle_state is distinct from 'active'
     or public.association_membership_effective_state(t) <> 'active' then
    raise exception 'membership_not_effective';
  end if;
  return new;
end;
$$;

-- 7c. memberships: insert rules (renewal lineage) and update rules (immutable snapshot + state machine)
create function public.association_memberships_insert_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  p public.association_memberships;
begin
  if new.state not in ('pending', 'active') then
    raise exception 'invalid_state';
  end if;
  if new.renewed_from is not null then
    select * into p from public.association_memberships where id = new.renewed_from;
    if not found or p.member_id <> new.member_id or p.association_id <> new.association_id
       or p.membership_number <> new.membership_number or p.state <> 'expired'
       or coalesce(p.ended_reason, '') not in ('renewed', 'lapsed') or new.state <> 'active' then
      raise exception 'invalid_renewal_lineage';
    end if;
  end if;
  return new;
end;
$$;

create function public.association_memberships_update_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if old.state in ('expired', 'cancelled') then
    raise exception 'membership_immutable';
  end if;
  if new.id is distinct from old.id or new.association_id is distinct from old.association_id
     or new.member_id is distinct from old.member_id or new.plan_id is distinct from old.plan_id
     or new.membership_number is distinct from old.membership_number or new.starts_at is distinct from old.starts_at
     or new.expires_at is distinct from old.expires_at or new.grace_days is distinct from old.grace_days
     or new.price_amount is distinct from old.price_amount or new.currency is distinct from old.currency
     or new.renewed_from is distinct from old.renewed_from or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'membership_immutable';
  end if;
  if new.state is distinct from old.state and not (
       (old.state = 'pending'   and new.state in ('active', 'cancelled'))
    or (old.state = 'active'    and new.state in ('suspended', 'expired', 'cancelled'))
    or (old.state = 'suspended' and new.state in ('active', 'expired', 'cancelled'))) then
    raise exception 'invalid_transition';
  end if;
  return new;
end;
$$;

create function public.association_audit_block_update() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  raise exception 'audit_immutable';
end;
$$;

create trigger trg_association_members_lifecycle
  before insert or update of status, lifecycle_state, lifecycle_changed_at on public.association_members
  for each row execute function public.association_members_lifecycle_guard();

create trigger trg_association_members_points_guard
  before update of points_balance on public.association_members
  for each row when (old.lifecycle_state is not null and new.points_balance is distinct from old.points_balance)
  execute function public.association_members_points_guard();

create trigger trg_association_memberships_insert_guard
  before insert on public.association_memberships
  for each row execute function public.association_memberships_insert_guard();

create trigger trg_association_memberships_update_guard
  before update on public.association_memberships
  for each row execute function public.association_memberships_update_guard();

create trigger trg_association_audit_block_update
  before update on public.association_audit_log
  for each row execute function public.association_audit_block_update();

-- ----------------------------------------------------------------------------
-- 8. The 11 narrow RPCs. Every RPC: SECURITY DEFINER, pinned search_path, service_role only. The caller
--    (a server route) passes p_actor DERIVED FROM THE AUTHENTICATED SESSION; each RPC re-verifies that
--    actor's Association permission inside the same transaction. Errors are stable codes.
--    Lock order everywhere: member row -> Association row (enroll only) -> plan row -> membership rows.
-- ----------------------------------------------------------------------------

-- 8.1 settings: opt-in flag + membership-number prefix (settings.manage)
create function public.association_update_membership_settings(p_association_id uuid, p_actor uuid,
                                                             p_enabled boolean, p_prefix text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  a public.associations;
  v_prefix text;
  v_cfg jsonb;
  v_changes jsonb := '{}'::jsonb;
begin
  if not public._assoc_actor_can(p_association_id, p_actor, 'settings.manage') then
    raise exception 'permission_denied';
  end if;
  if p_enabled is null then
    raise exception 'invalid_input';
  end if;
  select * into a from public.associations where id = p_association_id for update;
  if not found then
    raise exception 'association_not_found';
  end if;
  v_cfg := a.config;
  if p_prefix is not null then
    v_prefix := left(upper(regexp_replace(p_prefix, '[^A-Za-z0-9]', '', 'g')), 8);
    if v_prefix = '' then
      raise exception 'invalid_prefix';
    end if;
    if v_cfg ->> 'membership_number_prefix' is distinct from v_prefix then
      v_changes := v_changes || jsonb_build_object('membership_number_prefix',
        jsonb_build_object('from', v_cfg -> 'membership_number_prefix', 'to', to_jsonb(v_prefix)));
    end if;
    v_cfg := jsonb_set(v_cfg, '{membership_number_prefix}', to_jsonb(v_prefix), true);
  end if;
  if coalesce(v_cfg -> 'membership_enabled', 'false'::jsonb) is distinct from to_jsonb(p_enabled) then
    v_changes := v_changes || jsonb_build_object('membership_enabled',
      jsonb_build_object('from', coalesce(a.config -> 'membership_enabled', 'false'::jsonb), 'to', to_jsonb(p_enabled)));
  end if;
  v_cfg := jsonb_set(v_cfg, '{membership_enabled}', to_jsonb(p_enabled), true);
  update public.associations set config = v_cfg, updated_at = now() where id = a.id;
  if v_changes <> '{}'::jsonb then
    perform public._assoc_audit(a.id, p_actor, 'settings.membership_updated', 'association_settings', a.id, null, v_changes, '{}'::jsonb);
  end if;
  return jsonb_build_object('membership_enabled', p_enabled,
                            'membership_number_prefix', coalesce(v_cfg ->> 'membership_number_prefix', 'M'));
end;
$$;

-- 8.2 create plan (plans.manage; module must be enabled)
create function public.association_create_plan(p_association_id uuid, p_actor uuid, p_name_en text, p_name_fr text,
    p_description_en text, p_description_fr text, p_price_amount numeric, p_currency text,
    p_duration_months int, p_grace_days int, p_sort_order int) returns public.association_membership_plans
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_en text := btrim(coalesce(p_name_en, ''));
  v_fr text := btrim(coalesce(p_name_fr, ''));
  v_den text := nullif(btrim(coalesce(p_description_en, '')), '');
  v_dfr text := nullif(btrim(coalesce(p_description_fr, '')), '');
  v_price numeric := coalesce(p_price_amount, 0);
  v_cur text := upper(coalesce(nullif(btrim(p_currency), ''), 'XAF'));
  v_grace int := coalesce(p_grace_days, 0);
  n public.association_membership_plans;
begin
  if not public._assoc_actor_can(p_association_id, p_actor, 'plans.manage') then
    raise exception 'permission_denied';
  end if;
  if not public._assoc_membership_enabled(p_association_id) then
    raise exception 'membership_not_enabled';
  end if;
  if length(v_en) not between 1 and 80 or length(v_fr) not between 1 and 80
     or (v_den is null) <> (v_dfr is null) or length(coalesce(v_den, '')) > 500 or length(coalesce(v_dfr, '')) > 500
     or v_price < 0 or v_price > 9999999999.99 or v_cur !~ '^[A-Z]{3}$'
     or (p_duration_months is not null and p_duration_months not between 1 and 120)
     or v_grace not between 0 and 365 then
    raise exception 'invalid_input';
  end if;
  insert into public.association_membership_plans (association_id, name_en, name_fr, description_en, description_fr,
      price_amount, currency, duration_months, grace_days, sort_order, created_by)
  values (p_association_id, v_en, v_fr, v_den, v_dfr, v_price, v_cur, p_duration_months, v_grace, coalesce(p_sort_order, 0), p_actor)
  returning * into n;
  perform public._assoc_audit(n.association_id, p_actor, 'plan.created', 'plan', n.id, null, '{}'::jsonb,
    jsonb_build_object('name_en', n.name_en, 'price_amount', n.price_amount, 'currency', n.currency,
                       'duration_months', n.duration_months, 'grace_days', n.grace_days));
  return n;
end;
$$;

-- 8.3 update plan (plans.manage; module must be enabled). Existing memberships keep their own snapshots.
create function public.association_update_plan(p_plan_id uuid, p_actor uuid, p_name_en text, p_name_fr text,
    p_description_en text, p_description_fr text, p_price_amount numeric, p_currency text,
    p_duration_months int, p_grace_days int, p_sort_order int) returns public.association_membership_plans
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  o public.association_membership_plans;
  n public.association_membership_plans;
  v_en text := btrim(coalesce(p_name_en, ''));
  v_fr text := btrim(coalesce(p_name_fr, ''));
  v_den text := nullif(btrim(coalesce(p_description_en, '')), '');
  v_dfr text := nullif(btrim(coalesce(p_description_fr, '')), '');
  v_price numeric := coalesce(p_price_amount, 0);
  v_cur text := upper(coalesce(nullif(btrim(p_currency), ''), 'XAF'));
  v_grace int := coalesce(p_grace_days, 0);
  v_changes jsonb := '{}'::jsonb;
begin
  select * into o from public.association_membership_plans where id = p_plan_id;
  if not found then
    raise exception 'plan_not_found';
  end if;
  if not public._assoc_actor_can(o.association_id, p_actor, 'plans.manage') then
    raise exception 'permission_denied';
  end if;
  if not public._assoc_membership_enabled(o.association_id) then
    raise exception 'membership_not_enabled';
  end if;
  if length(v_en) not between 1 and 80 or length(v_fr) not between 1 and 80
     or (v_den is null) <> (v_dfr is null) or length(coalesce(v_den, '')) > 500 or length(coalesce(v_dfr, '')) > 500
     or v_price < 0 or v_price > 9999999999.99 or v_cur !~ '^[A-Z]{3}$'
     or (p_duration_months is not null and p_duration_months not between 1 and 120)
     or v_grace not between 0 and 365 then
    raise exception 'invalid_input';
  end if;
  select * into o from public.association_membership_plans where id = p_plan_id for update;
  update public.association_membership_plans
     set name_en = v_en, name_fr = v_fr, description_en = v_den, description_fr = v_dfr, price_amount = v_price,
         currency = v_cur, duration_months = p_duration_months, grace_days = v_grace,
         sort_order = coalesce(p_sort_order, o.sort_order), updated_at = now()
   where id = o.id returning * into n;
  if n.name_en is distinct from o.name_en then v_changes := v_changes || jsonb_build_object('name_en', jsonb_build_object('from', o.name_en, 'to', n.name_en)); end if;
  if n.name_fr is distinct from o.name_fr then v_changes := v_changes || jsonb_build_object('name_fr', jsonb_build_object('from', o.name_fr, 'to', n.name_fr)); end if;
  if n.price_amount is distinct from o.price_amount then v_changes := v_changes || jsonb_build_object('price_amount', jsonb_build_object('from', o.price_amount, 'to', n.price_amount)); end if;
  if n.currency is distinct from o.currency then v_changes := v_changes || jsonb_build_object('currency', jsonb_build_object('from', o.currency, 'to', n.currency)); end if;
  if n.duration_months is distinct from o.duration_months then v_changes := v_changes || jsonb_build_object('duration_months', jsonb_build_object('from', o.duration_months, 'to', n.duration_months)); end if;
  if n.grace_days is distinct from o.grace_days then v_changes := v_changes || jsonb_build_object('grace_days', jsonb_build_object('from', o.grace_days, 'to', n.grace_days)); end if;
  if n.description_en is distinct from o.description_en or n.description_fr is distinct from o.description_fr then
    v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('from', 'changed', 'to', 'changed'));
  end if;
  if n.sort_order is distinct from o.sort_order then v_changes := v_changes || jsonb_build_object('sort_order', jsonb_build_object('from', o.sort_order, 'to', n.sort_order)); end if;
  if v_changes <> '{}'::jsonb then
    perform public._assoc_audit(n.association_id, p_actor, 'plan.updated', 'plan', n.id, null, v_changes, '{}'::jsonb);
  end if;
  return n;
end;
$$;

-- 8.4 archive / unarchive a plan (plans.manage). Archiving is always allowed; unarchiving needs the module on.
create function public.association_set_plan_active(p_plan_id uuid, p_actor uuid, p_active boolean) returns public.association_membership_plans
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  o public.association_membership_plans;
  n public.association_membership_plans;
begin
  if p_active is null then
    raise exception 'invalid_input';
  end if;
  select * into o from public.association_membership_plans where id = p_plan_id;
  if not found then
    raise exception 'plan_not_found';
  end if;
  if not public._assoc_actor_can(o.association_id, p_actor, 'plans.manage') then
    raise exception 'permission_denied';
  end if;
  if p_active and not public._assoc_membership_enabled(o.association_id) then
    raise exception 'membership_not_enabled';
  end if;
  select * into o from public.association_membership_plans where id = p_plan_id for update;
  if o.active = p_active then
    return o;
  end if;
  update public.association_membership_plans set active = p_active, updated_at = now() where id = o.id returning * into n;
  perform public._assoc_audit(n.association_id, p_actor, case when p_active then 'plan.unarchived' else 'plan.archived' end,
    'plan', n.id, null, jsonb_build_object('active', jsonb_build_object('from', o.active, 'to', n.active)), '{}'::jsonb);
  return n;
end;
$$;

-- 8.5 ENROLL (memberships.manage; module must be enabled). Creates a NEW lineage and a new number.
--     Price, expiry and number are computed here; no client value is accepted for any of them.
create function public.association_start_membership(p_association_id uuid, p_actor uuid, p_member_id uuid,
                                                   p_plan_id uuid, p_starts_at timestamptz default null) returns public.association_memberships
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  mem public.association_members;
  assoc public.associations;
  pl public.association_membership_plans;
  cur public.association_memberships;
  n public.association_memberships;
  v_start timestamptz;
  v_immediate boolean;
  v_exp timestamptz;
  v_seq bigint;
  v_number text;
  v_prefix text;
begin
  if not public._assoc_actor_can(p_association_id, p_actor, 'memberships.manage') then
    raise exception 'permission_denied';
  end if;
  if not public._assoc_membership_enabled(p_association_id) then
    raise exception 'membership_not_enabled';
  end if;

  select * into mem from public.association_members where id = p_member_id for update;
  if not found or mem.association_id is distinct from p_association_id then
    raise exception 'member_not_found';
  end if;
  -- the legacy key stays authoritative: the member must also belong to this Association's legacy profile
  if mem.association_profile_id is distinct from (select a.legacy_profile_id from public.associations a where a.id = p_association_id) then
    raise exception 'member_association_mismatch';
  end if;
  if mem.lifecycle_state is null and mem.status = 'disabled' then
    raise exception 'member_disabled_legacy';
  end if;

  select * into cur from public.association_memberships
   where member_id = mem.id and state in ('pending', 'active', 'suspended') for update;
  if found then
    if cur.state in ('active', 'suspended') and public.association_membership_effective_state(cur) = 'expired' then
      perform public._assoc_materialize_expiry(cur.id, p_actor);
    else
      raise exception 'already_current_membership';
    end if;
  end if;

  select * into pl from public.association_membership_plans where id = p_plan_id for share;
  if not found or pl.association_id <> p_association_id then
    raise exception 'plan_not_found';
  end if;
  if not pl.active then
    raise exception 'plan_inactive';
  end if;

  if p_starts_at is not null and p_starts_at < now() - interval '1 minute' then
    raise exception 'start_in_past';
  end if;
  v_start := coalesce(p_starts_at, now());
  if v_start > now() + interval '366 days' then
    raise exception 'start_too_far';
  end if;
  v_immediate := v_start <= now() + interval '1 minute';
  if v_immediate then
    v_start := now();
  end if;
  v_exp := case when pl.duration_months is null then null
                else ((v_start at time zone 'UTC') + make_interval(months => pl.duration_months)) at time zone 'UTC' end;

  -- race-safe, gapless, never-reused number: the increment commits or rolls back with the insert
  update public.associations set membership_seq = membership_seq + 1
   where id = p_association_id returning * into assoc;
  v_seq := assoc.membership_seq;
  v_prefix := coalesce(nullif(left(upper(regexp_replace(coalesce(assoc.config ->> 'membership_number_prefix', ''), '[^A-Za-z0-9]', '', 'g')), 8), ''), 'M');
  v_number := v_prefix || '-' || case when length(v_seq::text) >= 6 then v_seq::text else lpad(v_seq::text, 6, '0') end;

  insert into public.association_memberships (association_id, member_id, plan_id, membership_number, state, starts_at,
      expires_at, grace_days, price_amount, currency, activated_at, created_by)
  values (p_association_id, mem.id, pl.id, v_number, case when v_immediate then 'active' else 'pending' end, v_start,
      v_exp, pl.grace_days, pl.price_amount, pl.currency, case when v_immediate then now() else null end, p_actor)
  returning * into n;

  update public.association_members set lifecycle_state = n.state where id = mem.id;

  perform public._assoc_audit(p_association_id, p_actor, 'membership.enrolled', 'membership', n.id, mem.id,
    jsonb_build_object('state', jsonb_build_object('from', mem.lifecycle_state, 'to', n.state)),
    jsonb_build_object('plan_id', pl.id, 'membership_number', n.membership_number, 'starts_at', n.starts_at, 'expires_at', n.expires_at));
  return n;
end;
$$;

-- 8.6 ACTIVATE a due pending term (memberships.manage; module must be enabled). Never early.
create function public.association_activate_membership(p_membership_id uuid, p_actor uuid) returns public.association_memberships
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  m public.association_memberships;
begin
  select * into m from public.association_memberships where id = p_membership_id;
  if not found then
    raise exception 'membership_not_found';
  end if;
  if not public._assoc_actor_can(m.association_id, p_actor, 'memberships.manage') then
    raise exception 'permission_denied';
  end if;
  if not public._assoc_membership_enabled(m.association_id) then
    raise exception 'membership_not_enabled';
  end if;
  perform 1 from public.association_members where id = m.member_id for update;
  select * into m from public.association_memberships where id = p_membership_id for update;
  if m.state <> 'pending' then
    raise exception 'invalid_state';
  end if;
  if m.starts_at > now() then
    raise exception 'not_started';
  end if;
  if m.expires_at is not null and now() >= m.expires_at + make_interval(hours => m.grace_days * 24) then
    raise exception 'term_ended';
  end if;
  update public.association_memberships set state = 'active', activated_at = now(), updated_at = now()
   where id = m.id returning * into m;
  update public.association_members set lifecycle_state = 'active' where id = m.member_id and lifecycle_state is distinct from 'active';
  perform public._assoc_audit(m.association_id, p_actor, 'membership.activated', 'membership', m.id, m.member_id,
    jsonb_build_object('state', jsonb_build_object('from', 'pending', 'to', 'active')), '{}'::jsonb);
  return m;
end;
$$;

-- 8.7 SUSPEND an active term (memberships.manage). The term clock keeps running.
--     An effectively-ended term is materialized to 'expired' and returned (no error, so it persists).
create function public.association_suspend_membership(p_membership_id uuid, p_actor uuid, p_reason text default null) returns public.association_memberships
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  m public.association_memberships;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into m from public.association_memberships where id = p_membership_id;
  if not found then
    raise exception 'membership_not_found';
  end if;
  if not public._assoc_actor_can(m.association_id, p_actor, 'memberships.manage') then
    raise exception 'permission_denied';
  end if;
  if length(coalesce(v_reason, '')) > 300 then
    raise exception 'invalid_input';
  end if;
  perform 1 from public.association_members where id = m.member_id for update;
  select * into m from public.association_memberships where id = p_membership_id for update;
  if m.state = 'active' and public.association_membership_effective_state(m) = 'expired' then
    perform public._assoc_materialize_expiry(m.id, p_actor);
    select * into m from public.association_memberships where id = p_membership_id;
    return m;
  end if;
  if m.state <> 'active' then
    raise exception 'invalid_state';
  end if;
  update public.association_memberships set state = 'suspended', state_reason = v_reason, updated_at = now()
   where id = m.id returning * into m;
  update public.association_members set lifecycle_state = 'suspended' where id = m.member_id and lifecycle_state is distinct from 'suspended';
  perform public._assoc_audit(m.association_id, p_actor, 'membership.suspended', 'membership', m.id, m.member_id,
    jsonb_build_object('state', jsonb_build_object('from', 'active', 'to', 'suspended')),
    jsonb_build_object('reason', v_reason));
  return m;
end;
$$;

-- 8.8 REINSTATE a suspended term while it is still valid (memberships.manage). NOT a renewal.
create function public.association_reinstate_membership(p_membership_id uuid, p_actor uuid) returns public.association_memberships
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  m public.association_memberships;
begin
  select * into m from public.association_memberships where id = p_membership_id;
  if not found then
    raise exception 'membership_not_found';
  end if;
  if not public._assoc_actor_can(m.association_id, p_actor, 'memberships.manage') then
    raise exception 'permission_denied';
  end if;
  perform 1 from public.association_members where id = m.member_id for update;
  select * into m from public.association_memberships where id = p_membership_id for update;
  if m.state = 'suspended' and public.association_membership_effective_state(m) = 'expired' then
    perform public._assoc_materialize_expiry(m.id, p_actor);
    select * into m from public.association_memberships where id = p_membership_id;
    return m;
  end if;
  if m.state <> 'suspended' then
    raise exception 'invalid_state';
  end if;
  update public.association_memberships set state = 'active', state_reason = null, updated_at = now()
   where id = m.id returning * into m;
  update public.association_members set lifecycle_state = 'active' where id = m.member_id and lifecycle_state is distinct from 'active';
  perform public._assoc_audit(m.association_id, p_actor, 'membership.reinstated', 'membership', m.id, m.member_id,
    jsonb_build_object('state', jsonb_build_object('from', 'suspended', 'to', 'active')), '{}'::jsonb);
  return m;
end;
$$;

-- 8.9 RENEW (memberships.manage; module must be enabled). Creates a NEW historical term that keeps the
--     ancestor's membership number; closes the old term; never rewrites any snapshot.
--     p_membership_id must be the member's latest, not-yet-renewed term (a stale double-click is rejected).
create function public.association_renew_membership(p_membership_id uuid, p_actor uuid, p_plan_id uuid default null) returns public.association_memberships
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  m public.association_memberships;
  n public.association_memberships;
  pl public.association_membership_plans;
  v_base timestamptz;
  v_exp timestamptz;
begin
  select * into m from public.association_memberships where id = p_membership_id;
  if not found then
    raise exception 'membership_not_found';
  end if;
  if not public._assoc_actor_can(m.association_id, p_actor, 'memberships.manage') then
    raise exception 'permission_denied';
  end if;
  if not public._assoc_membership_enabled(m.association_id) then
    raise exception 'membership_not_enabled';
  end if;
  perform 1 from public.association_members where id = m.member_id for update;
  select * into m from public.association_memberships where id = p_membership_id for update;

  if exists (select 1 from public.association_memberships x where x.renewed_from = m.id) then
    raise exception 'already_renewed';
  end if;
  if m.state = 'active' and public.association_membership_effective_state(m) = 'expired' then
    perform public._assoc_materialize_expiry(m.id, p_actor);
    select * into m from public.association_memberships where id = p_membership_id;
  end if;
  if m.state = 'suspended' then
    raise exception 'suspended_must_reinstate';
  end if;
  if m.state not in ('active', 'expired') or (m.state = 'expired' and coalesce(m.ended_reason, '') <> 'lapsed') then
    raise exception 'invalid_state';
  end if;
  if exists (select 1 from public.association_memberships x where x.member_id = m.member_id and x.created_at > m.created_at) then
    raise exception 'not_latest_term';
  end if;
  if exists (select 1 from public.association_memberships x
              where x.member_id = m.member_id and x.id <> m.id and x.state in ('pending', 'active', 'suspended')) then
    raise exception 'already_current_membership';
  end if;
  if m.state = 'active' and m.expires_at is null then
    raise exception 'no_renewal_needed';
  end if;

  select * into pl from public.association_membership_plans where id = coalesce(p_plan_id, m.plan_id) for share;
  if not found or pl.association_id <> m.association_id then
    raise exception 'plan_not_found';
  end if;
  if not pl.active then
    raise exception 'plan_inactive';
  end if;

  v_base := case when m.state = 'active' and m.expires_at is not null and m.expires_at > now() then m.expires_at else now() end;
  v_exp := case when pl.duration_months is null then null
                else ((v_base at time zone 'UTC') + make_interval(months => pl.duration_months)) at time zone 'UTC' end;

  if m.state = 'active' then
    update public.association_memberships set state = 'expired', ended_reason = 'renewed', ended_at = now(), updated_at = now()
     where id = m.id;
  end if;

  insert into public.association_memberships (association_id, member_id, plan_id, membership_number, state, starts_at,
      expires_at, grace_days, price_amount, currency, activated_at, renewed_from, created_by)
  values (m.association_id, m.member_id, pl.id, m.membership_number, 'active', now(),
      v_exp, pl.grace_days, pl.price_amount, pl.currency, now(), m.id, p_actor)
  returning * into n;

  update public.association_members set lifecycle_state = 'active' where id = m.member_id and lifecycle_state is distinct from 'active';

  perform public._assoc_audit(m.association_id, p_actor, 'membership.renewed', 'membership', n.id, m.member_id,
    jsonb_build_object('expires_at', jsonb_build_object('from', m.expires_at, 'to', n.expires_at),
                       'plan_id', jsonb_build_object('from', m.plan_id, 'to', n.plan_id)),
    jsonb_build_object('previous_membership_id', m.id, 'membership_number', n.membership_number));
  return n;
end;
$$;

-- 8.10 CANCEL a term (memberships.manage). Terminal.
create function public.association_cancel_membership(p_membership_id uuid, p_actor uuid, p_reason text default null) returns public.association_memberships
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  m public.association_memberships;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_from text;
begin
  select * into m from public.association_memberships where id = p_membership_id;
  if not found then
    raise exception 'membership_not_found';
  end if;
  if not public._assoc_actor_can(m.association_id, p_actor, 'memberships.manage') then
    raise exception 'permission_denied';
  end if;
  if length(coalesce(v_reason, '')) > 300 then
    raise exception 'invalid_input';
  end if;
  perform 1 from public.association_members where id = m.member_id for update;
  select * into m from public.association_memberships where id = p_membership_id for update;
  if m.state in ('active', 'suspended') and public.association_membership_effective_state(m) = 'expired' then
    perform public._assoc_materialize_expiry(m.id, p_actor);
    select * into m from public.association_memberships where id = p_membership_id;
    return m;
  end if;
  if m.state not in ('pending', 'active', 'suspended') then
    raise exception 'invalid_state';
  end if;
  v_from := m.state;
  update public.association_memberships
     set state = 'cancelled', ended_reason = 'cancelled', ended_at = now(), state_reason = v_reason, updated_at = now()
   where id = m.id returning * into m;
  update public.association_members set lifecycle_state = 'cancelled' where id = m.member_id and lifecycle_state is distinct from 'cancelled';
  perform public._assoc_audit(m.association_id, p_actor, 'membership.cancelled', 'membership', m.id, m.member_id,
    jsonb_build_object('state', jsonb_build_object('from', v_from, 'to', 'cancelled')),
    jsonb_build_object('reason', v_reason));
  return m;
end;
$$;

-- 8.11 EXPIRE due terms. Convergence only: security never depends on this having run (the effective-state
--      function and the balance guard decide). p_actor NULL = system call (service_role only, all Associations);
--      with an actor it is scoped to one Association and needs memberships.manage. Idempotent and bounded.
create function public.association_expire_memberships(p_association_id uuid default null, p_actor uuid default null,
                                                     p_limit int default 500) returns integer
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  r record;
  v_count integer := 0;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
begin
  if p_actor is not null and (p_association_id is null or not public._assoc_actor_can(p_association_id, p_actor, 'memberships.manage')) then
    raise exception 'permission_denied';
  end if;
  for r in
    select x.id, x.member_id from public.association_memberships x
     where x.state in ('active', 'suspended') and x.expires_at is not null
       and now() >= x.expires_at + make_interval(hours => x.grace_days * 24)
       and (p_association_id is null or x.association_id = p_association_id)
     order by x.expires_at limit v_limit
  loop
    perform 1 from public.association_members where id = r.member_id for update;
    if public._assoc_materialize_expiry(r.id, p_actor) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. RLS (SELECT only, authenticated only, Association-scoped; no is_admin())
-- ----------------------------------------------------------------------------
alter table public.association_membership_plans enable row level security;
alter table public.association_memberships enable row level security;
alter table public.association_audit_log enable row level security;

create policy "association_membership_plans read" on public.association_membership_plans
  for select to authenticated using (public.association_staff_role(association_id) is not null);
create policy "association_memberships read" on public.association_memberships
  for select to authenticated using (
    public.has_association_permission(association_id, 'memberships.view')
    or public.has_association_permission(association_id, 'memberships.manage'));
create policy "association_audit_log read" on public.association_audit_log
  for select to authenticated using (public.has_association_permission(association_id, 'audit.view'));

-- ----------------------------------------------------------------------------
-- 10. Privileges. New tables: RPC-only writes. NO existing table privilege is changed.
-- ----------------------------------------------------------------------------
revoke all on public.association_membership_plans, public.association_memberships, public.association_audit_log from public;
revoke all on public.association_membership_plans, public.association_memberships, public.association_audit_log from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.association_membership_plans, public.association_memberships, public.association_audit_log from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.association_membership_plans, public.association_memberships, public.association_audit_log from service_role;

revoke all on public.association_memberships_effective from public;
revoke all on public.association_memberships_effective from anon, authenticated;
grant select on public.association_memberships_effective to service_role;

-- the 11 RPCs: service_role only
revoke all on function public.association_update_membership_settings(uuid, uuid, boolean, text) from public;
revoke all on function public.association_update_membership_settings(uuid, uuid, boolean, text) from anon, authenticated;
grant execute on function public.association_update_membership_settings(uuid, uuid, boolean, text) to service_role;
revoke all on function public.association_create_plan(uuid, uuid, text, text, text, text, numeric, text, int, int, int) from public;
revoke all on function public.association_create_plan(uuid, uuid, text, text, text, text, numeric, text, int, int, int) from anon, authenticated;
grant execute on function public.association_create_plan(uuid, uuid, text, text, text, text, numeric, text, int, int, int) to service_role;
revoke all on function public.association_update_plan(uuid, uuid, text, text, text, text, numeric, text, int, int, int) from public;
revoke all on function public.association_update_plan(uuid, uuid, text, text, text, text, numeric, text, int, int, int) from anon, authenticated;
grant execute on function public.association_update_plan(uuid, uuid, text, text, text, text, numeric, text, int, int, int) to service_role;
revoke all on function public.association_set_plan_active(uuid, uuid, boolean) from public;
revoke all on function public.association_set_plan_active(uuid, uuid, boolean) from anon, authenticated;
grant execute on function public.association_set_plan_active(uuid, uuid, boolean) to service_role;
revoke all on function public.association_start_membership(uuid, uuid, uuid, uuid, timestamptz) from public;
revoke all on function public.association_start_membership(uuid, uuid, uuid, uuid, timestamptz) from anon, authenticated;
grant execute on function public.association_start_membership(uuid, uuid, uuid, uuid, timestamptz) to service_role;
revoke all on function public.association_activate_membership(uuid, uuid) from public;
revoke all on function public.association_activate_membership(uuid, uuid) from anon, authenticated;
grant execute on function public.association_activate_membership(uuid, uuid) to service_role;
revoke all on function public.association_suspend_membership(uuid, uuid, text) from public;
revoke all on function public.association_suspend_membership(uuid, uuid, text) from anon, authenticated;
grant execute on function public.association_suspend_membership(uuid, uuid, text) to service_role;
revoke all on function public.association_reinstate_membership(uuid, uuid) from public;
revoke all on function public.association_reinstate_membership(uuid, uuid) from anon, authenticated;
grant execute on function public.association_reinstate_membership(uuid, uuid) to service_role;
revoke all on function public.association_renew_membership(uuid, uuid, uuid) from public;
revoke all on function public.association_renew_membership(uuid, uuid, uuid) from anon, authenticated;
grant execute on function public.association_renew_membership(uuid, uuid, uuid) to service_role;
revoke all on function public.association_cancel_membership(uuid, uuid, text) from public;
revoke all on function public.association_cancel_membership(uuid, uuid, text) from anon, authenticated;
grant execute on function public.association_cancel_membership(uuid, uuid, text) to service_role;
revoke all on function public.association_expire_memberships(uuid, uuid, int) from public;
revoke all on function public.association_expire_memberships(uuid, uuid, int) from anon, authenticated;
grant execute on function public.association_expire_memberships(uuid, uuid, int) to service_role;

-- The effective-state function is PURE (reads no table; only the row it is given and now()). It must be
-- executable by service_role alone, because PostgreSQL checks EXECUTE for the CALLING role even inside a
-- view, so service_role could not read association_memberships_effective without it. Nobody else may call it.
revoke all on function public.association_membership_effective_state(public.association_memberships) from public;
revoke all on function public.association_membership_effective_state(public.association_memberships) from anon, authenticated;
grant execute on function public.association_membership_effective_state(public.association_memberships) to service_role;

-- private helpers and trigger functions: no API role at all
revoke all on function public._assoc_actor_can(uuid, uuid, text) from public;
revoke all on function public._assoc_actor_can(uuid, uuid, text) from anon, authenticated, service_role;
revoke all on function public._assoc_membership_enabled(uuid) from public;
revoke all on function public._assoc_membership_enabled(uuid) from anon, authenticated, service_role;
revoke all on function public._assoc_audit(uuid, uuid, text, text, uuid, uuid, jsonb, jsonb) from public;
revoke all on function public._assoc_audit(uuid, uuid, text, text, uuid, uuid, jsonb, jsonb) from anon, authenticated, service_role;
revoke all on function public._assoc_materialize_expiry(uuid, uuid) from public;
revoke all on function public._assoc_materialize_expiry(uuid, uuid) from anon, authenticated, service_role;
revoke all on function public.association_members_lifecycle_guard() from public;
revoke all on function public.association_members_lifecycle_guard() from anon, authenticated, service_role;
revoke all on function public.association_members_points_guard() from public;
revoke all on function public.association_members_points_guard() from anon, authenticated, service_role;
revoke all on function public.association_memberships_insert_guard() from public;
revoke all on function public.association_memberships_insert_guard() from anon, authenticated, service_role;
revoke all on function public.association_memberships_update_guard() from public;
revoke all on function public.association_memberships_update_guard() from anon, authenticated, service_role;
revoke all on function public.association_audit_block_update() from public;
revoke all on function public.association_audit_block_update() from anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 11. POSTCONDITIONS - any failure RAISEs and rolls the whole migration back
-- ----------------------------------------------------------------------------
do $$
declare
  pre jsonb := current_setting('assoc_b1.pre')::jsonb;
  v_six text[] := array['association_members', 'association_partners', 'association_rewards',
                        'association_settings', 'association_point_transactions', 'association_invitations'];
  v_n bigint;
  v_txt text;
  r record;
begin
  -- existing data untouched
  if (select count(*) from public.association_members) <> (pre->>'members')::bigint then raise exception 'B1 postcondition: association_members count changed'; end if;
  if (select count(*) from public.association_partners) <> (pre->>'partners')::bigint then raise exception 'B1 postcondition: association_partners count changed'; end if;
  if (select count(*) from public.association_rewards) <> (pre->>'rewards')::bigint then raise exception 'B1 postcondition: association_rewards count changed'; end if;
  if (select count(*) from public.association_settings) <> (pre->>'settings')::bigint then raise exception 'B1 postcondition: association_settings count changed'; end if;
  if (select count(*) from public.association_point_transactions) <> (pre->>'ledger')::bigint then raise exception 'B1 postcondition: ledger count changed'; end if;
  if (select count(*) from public.association_invitations) <> (pre->>'invites')::bigint then raise exception 'B1 postcondition: invitations count changed'; end if;
  if (select count(*) from public.associations) <> (pre->>'associations')::bigint then raise exception 'B1 postcondition: associations count changed'; end if;
  if (select count(*) from public.users) <> (pre->>'users')::bigint or (select count(*) from public.profiles) <> (pre->>'profiles')::bigint then
    raise exception 'B1 postcondition: users/profiles count changed';
  end if;
  if (select count(*) from public.association_members where status = 'active') <> (pre->>'members_active')::bigint
     or (select count(*) from public.association_members where status = 'disabled') <> (pre->>'members_disabled')::bigint then
    raise exception 'B1 postcondition: a legacy member status changed';
  end if;

  -- points integrity (and no legacy member became managed)
  if (select coalesce(sum(points_balance), 0) from public.association_members) <> (pre->>'balance')::bigint
     or (select coalesce(sum(points_delta), 0) from public.association_point_transactions) <> (pre->>'points')::bigint then
    raise exception 'B1 postcondition: points totals changed';
  end if;
  select count(*) into v_n from (
    select m.id from public.association_members m left join public.association_point_transactions t on t.member_id = m.id
    group by m.id, m.points_balance having m.points_balance <> coalesce(sum(t.points_delta), 0)) d;
  if v_n <> 0 then raise exception 'B1 postcondition: % member(s) whose balance differs from their ledger', v_n; end if;
  if (select count(*) from public.association_members where lifecycle_state is not null or lifecycle_changed_at is not null) <> 0 then
    raise exception 'B1 postcondition: an existing member was made managed (no backfill is allowed)';
  end if;

  -- nothing was seeded; module defaults OFF; existing config untouched
  if (select count(*) from public.association_membership_plans) <> 0
     or (select count(*) from public.association_memberships) <> 0
     or (select count(*) from public.association_audit_log) <> 0 then
    raise exception 'B1 postcondition: new tables must be empty';
  end if;
  if (select count(*) from public.associations where membership_seq <> 0) <> 0 then raise exception 'B1 postcondition: membership_seq must be 0'; end if;
  if (select md5(coalesce(string_agg(id::text || config::text, '|' order by id), '')) from public.associations) <> pre->>'config_md5' then
    raise exception 'B1 postcondition: association config changed';
  end if;
  if (select count(*) from public.associations where public._assoc_membership_enabled(id)) <> 0 then
    raise exception 'B1 postcondition: Membership must default OFF';
  end if;

  -- protected legacy objects unchanged
  if (select md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'log_association_earn') <> pre->>'earn_md5'
     or (select md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'log_association_redeem') <> pre->>'redeem_md5' then
    raise exception 'B1 postcondition: earn/redeem definition changed';
  end if;
  if (select md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' order by tablename, policyname), ''))
        from pg_policies where schemaname = 'public' and tablename = any(v_six)) <> pre->>'policies_md5' then
    raise exception 'B1 postcondition: an existing Association RLS policy changed';
  end if;
  if (select md5(coalesce(string_agg(c.relname || '=' || coalesce(c.relacl::text, ''), '|' order by c.relname), ''))
        from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any(v_six)) <> pre->>'legacy_acl_md5' then
    raise exception 'B1 postcondition: an existing table privilege changed';
  end if;

  -- owner-identity trust, re-verified after all DDL
  select pg_get_userbyid(relowner) into v_txt from pg_class where oid = 'public.association_members'::regclass;
  if v_txt is distinct from current_user::text then raise exception 'B1 postcondition: association_members owner changed'; end if;
  if exists (select 1 from pg_roles ro where ro.rolname in ('anon', 'authenticated', 'service_role', 'authenticator')
               and (ro.rolname::text = v_txt or pg_has_role(ro.rolname::text, v_txt, 'MEMBER'))) then
    raise exception 'B1 postcondition: an API role is, or can become, the table owner';
  end if;
  select string_agg(p.proname, ', ') into v_txt from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = any(array[
      'association_update_membership_settings', 'association_create_plan', 'association_update_plan',
      'association_set_plan_active', 'association_start_membership', 'association_activate_membership',
      'association_suspend_membership', 'association_reinstate_membership', 'association_renew_membership',
      'association_cancel_membership', 'association_expire_memberships', 'association_membership_effective_state',
      '_assoc_actor_can', '_assoc_membership_enabled', '_assoc_audit', '_assoc_materialize_expiry',
      'association_members_lifecycle_guard', 'association_members_points_guard', 'association_memberships_insert_guard',
      'association_memberships_update_guard', 'association_audit_block_update', 'log_association_earn', 'log_association_redeem'])
     and pg_get_userbyid(p.proowner) is distinct from current_user::text;
  if v_txt is not null then raise exception 'B1 postcondition: function(s) not owned by the table owner: %', v_txt; end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname in ('association_members_lifecycle_guard', 'association_members_points_guard') and p.prosecdef) then
    raise exception 'B1 postcondition: the lifecycle and points guards must be SECURITY INVOKER (their owner check reads current_user)';
  end if;

  -- reconciliation still clean
  select coalesce(sum(gaps_after), 0) into v_n from public.reconcile_association_links(false);
  if v_n <> 0 then raise exception 'B1 postcondition: reconcile_association_links reports % gap(s)', v_n; end if;

  -- triggers: exactly the expected set
  select string_agg(tg.tgname, ', ' order by tg.tgname) into v_txt from pg_trigger tg
   where tg.tgrelid = 'public.association_members'::regclass and not tg.tgisinternal;
  if v_txt is distinct from 'trg_association_members_lifecycle, trg_association_members_points_guard, trg_sync_association_id' then
    raise exception 'B1 postcondition: unexpected trigger set on association_members: %', v_txt;
  end if;
  select string_agg(tg.tgname, ', ' order by tg.tgname) into v_txt from pg_trigger tg
   where tg.tgrelid = 'public.association_memberships'::regclass and not tg.tgisinternal;
  if v_txt is distinct from 'trg_association_memberships_insert_guard, trg_association_memberships_update_guard' then
    raise exception 'B1 postcondition: unexpected trigger set on association_memberships: %', v_txt;
  end if;
  select string_agg(tg.tgname, ', ') into v_txt from pg_trigger tg
   where tg.tgrelid = 'public.association_audit_log'::regclass and not tg.tgisinternal;
  if v_txt is distinct from 'trg_association_audit_block_update' then
    raise exception 'B1 postcondition: unexpected trigger set on association_audit_log: %', v_txt;
  end if;

  -- foreign-key behaviour, read from the live catalog
  select string_agg(con.conrelid::regclass::text || '.' || con.conname, ', ') into v_txt from pg_constraint con
   where con.contype = 'f' and con.confrelid = 'public.associations'::regclass and con.confdeltype <> 'c';
  if v_txt is not null then raise exception 'B1 postcondition: non-cascade FK(s) reference associations: %', v_txt; end if;
  select count(*) into v_n from pg_constraint con
   where con.conrelid = 'public.association_memberships'::regclass and con.conname = 'association_memberships_member_fk' and con.confdeltype = 'c';
  if v_n <> 1 then raise exception 'B1 postcondition: memberships->members FK must cascade'; end if;
  select count(*) into v_n from pg_constraint con
   where con.conrelid = 'public.association_memberships'::regclass and con.conname in ('association_memberships_plan_fk', 'association_memberships_renewed_from_fk')
     and con.confdeltype = 'a' and con.condeferrable and con.condeferred;
  if v_n <> 2 then raise exception 'B1 postcondition: plan and renewal FKs must be NO ACTION, deferred (history must never cascade away)'; end if;
  select count(*) into v_n from pg_constraint con
   where con.contype = 'f' and con.conrelid in ('public.association_membership_plans'::regclass, 'public.association_memberships'::regclass, 'public.association_audit_log'::regclass)
     and con.confrelid in ('public.users'::regclass, 'public.profiles'::regclass);
  if v_n <> 0 then raise exception 'B1 postcondition: a new table references users/profiles (demo cleanup would be at risk)'; end if;
  select string_agg(con.conrelid::regclass::text, ', ') into v_txt from pg_constraint con
   where con.contype = 'f' and con.confrelid in ('public.association_membership_plans'::regclass, 'public.association_memberships'::regclass, 'public.association_audit_log'::regclass)
     and con.conrelid not in ('public.association_memberships'::regclass);
  if v_txt is not null then raise exception 'B1 postcondition: unexpected table(s) reference the new tables: %', v_txt; end if;

  -- RLS + policies
  select count(*) into v_n from pg_class c
   where c.oid in ('public.association_membership_plans'::regclass, 'public.association_memberships'::regclass, 'public.association_audit_log'::regclass)
     and c.relrowsecurity and not c.relforcerowsecurity;
  if v_n <> 3 then raise exception 'B1 postcondition: RLS must be enabled on the 3 new tables'; end if;
  select string_agg(tablename || ':' || policyname || ':' || cmd, ', ' order by tablename) into v_txt from pg_policies
   where schemaname = 'public' and tablename in ('association_membership_plans', 'association_memberships', 'association_audit_log');
  if v_txt is distinct from 'association_audit_log:association_audit_log read:SELECT, association_membership_plans:association_membership_plans read:SELECT, association_memberships:association_memberships read:SELECT' then
    raise exception 'B1 postcondition: unexpected policies on the new tables: %', v_txt;
  end if;

  -- table privileges: authenticated and service_role SELECT only, anon nothing, nobody via PUBLIC
  for r in select t as tbl from unnest(array['association_membership_plans', 'association_memberships', 'association_audit_log']) t loop
    if has_table_privilege('anon', ('public.' || r.tbl)::regclass, 'SELECT') then raise exception 'B1 postcondition: anon can read %', r.tbl; end if;
    if not has_table_privilege('authenticated', ('public.' || r.tbl)::regclass, 'SELECT') then raise exception 'B1 postcondition: authenticated cannot read %', r.tbl; end if;
    if not has_table_privilege('service_role', ('public.' || r.tbl)::regclass, 'SELECT') then raise exception 'B1 postcondition: service_role cannot read %', r.tbl; end if;
    if exists (select 1 from unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr
                where has_table_privilege('anon', ('public.' || r.tbl)::regclass, pr)
                   or has_table_privilege('authenticated', ('public.' || r.tbl)::regclass, pr)
                   or has_table_privilege('service_role', ('public.' || r.tbl)::regclass, pr)) then
      raise exception 'B1 postcondition: a client role has a write privilege on % (writes must go through the RPCs)', r.tbl;
    end if;
    if exists (select 1 from pg_class c, aclexplode(c.relacl) a where c.oid = ('public.' || r.tbl)::regclass and a.grantee = 0) then
      raise exception 'B1 postcondition: PUBLIC has a grant on %', r.tbl;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.association_memberships_effective'::regclass, 'SELECT')
     or has_table_privilege('authenticated', 'public.association_memberships_effective'::regclass, 'SELECT')
     or not has_table_privilege('service_role', 'public.association_memberships_effective'::regclass, 'SELECT') then
    raise exception 'B1 postcondition: association_memberships_effective must be readable by service_role only';
  end if;

  -- functions: definer flags, pinned search_path, EXECUTE grants
  for r in
    select p.oid, p.proname, p.prosecdef, p.proconfig::text as cfg, p.proacl
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(array[
      'association_update_membership_settings', 'association_create_plan', 'association_update_plan',
      'association_set_plan_active', 'association_start_membership', 'association_activate_membership',
      'association_suspend_membership', 'association_reinstate_membership', 'association_renew_membership',
      'association_cancel_membership', 'association_expire_memberships'])
  loop
    if not r.prosecdef or r.cfg is null or r.cfg not like '%pg_catalog, public, pg_temp%' then
      raise exception 'B1 postcondition: % must be SECURITY DEFINER with a pinned search_path', r.proname;
    end if;
    if not has_function_privilege('service_role', r.oid, 'EXECUTE')
       or has_function_privilege('anon', r.oid, 'EXECUTE') or has_function_privilege('authenticated', r.oid, 'EXECUTE')
       or exists (select 1 from aclexplode(r.proacl) a where a.grantee = 0) then
      raise exception 'B1 postcondition: % must be executable by service_role only', r.proname;
    end if;
  end loop;
  select count(*) into v_n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(array[
      'association_update_membership_settings', 'association_create_plan', 'association_update_plan',
      'association_set_plan_active', 'association_start_membership', 'association_activate_membership',
      'association_suspend_membership', 'association_reinstate_membership', 'association_renew_membership',
      'association_cancel_membership', 'association_expire_memberships']);
  if v_n <> 11 then raise exception 'B1 postcondition: expected 11 membership RPCs, found %', v_n; end if;
  -- the pure effective-state function: service_role only
  for r in select p.oid, p.proacl from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'association_membership_effective_state' loop
    if not has_function_privilege('service_role', r.oid, 'EXECUTE')
       or has_function_privilege('anon', r.oid, 'EXECUTE') or has_function_privilege('authenticated', r.oid, 'EXECUTE')
       or exists (select 1 from aclexplode(r.proacl) a where a.grantee = 0) then
      raise exception 'B1 postcondition: association_membership_effective_state must be executable by service_role only';
    end if;
  end loop;
  for r in
    select p.oid, p.proname, p.proacl from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(array[
      '_assoc_actor_can', '_assoc_membership_enabled', '_assoc_audit', '_assoc_materialize_expiry',
      'association_members_lifecycle_guard', 'association_members_points_guard', 'association_memberships_insert_guard',
      'association_memberships_update_guard', 'association_audit_block_update'])
  loop
    if has_function_privilege('anon', r.oid, 'EXECUTE') or has_function_privilege('authenticated', r.oid, 'EXECUTE')
       or has_function_privilege('service_role', r.oid, 'EXECUTE') or exists (select 1 from aclexplode(r.proacl) a where a.grantee = 0) then
      raise exception 'B1 postcondition: internal function % must not be executable by any API role', r.proname;
    end if;
  end loop;
end $$;

commit;
