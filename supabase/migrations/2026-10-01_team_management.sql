-- Team & Organization Management — universal, works across every category.
--
-- DESIGN NOTE (read this before touching anything below): Ringo has no
-- separate "organizations" table and doesn't need one. An "organization" IS
-- an existing `profiles` row — every category-owned resource (orders,
-- menu_items, restaurant_tables, tracks, bookings, ticket types, ...) is
-- already scoped by profile_id, exactly the shape a team needs to plug
-- into. See 2026-09-15_restaurant_food.sql's own header, which flagged this
-- as "explicitly Phase 2." This migration builds that phase.
--
-- The existing owner (profiles.user_id) is NOT duplicated into
-- organization_members and never gets a membership row — "owner" stays
-- exactly what it has always been (profiles.user_id = auth.uid(), checked
-- the same way every existing RLS policy already checks it). Nothing about
-- today's ownership model changes. organization_members only ever holds
-- people ADDED beyond the owner.
--
-- Every RLS policy below is a NEW, additive PERMISSIVE policy layered
-- alongside the owner/admin policies that already exist on `profiles` and
-- every restaurant table — Postgres OR's multiple permissive policies for
-- the same command together, so nothing existing is dropped, replaced, or
-- rewritten. Additive/idempotent throughout (create table if not exists,
-- create index if not exists, drop policy if exists + recreate only for
-- policies this migration itself owns), same convention every migration
-- since 2026-09-12 uses.

-- ============================================================================
-- 1. ROLES — a named, ordered set of permission strings, scoped to one
--    organization. Default role templates per category live in code (see
--    src/lib/team/permissions.ts) and are materialized into real rows here
--    the first time an organization needs one (src/lib/team/access.ts,
--    ensureDefaultRoles) — never hardcoded as shared/global rows, so an
--    owner can freely rename or re-permission their own copy without
--    touching a template other organizations also use.
-- ============================================================================
create table if not exists organization_roles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  key text not null,                        -- stable slug: 'chef', 'manager', or a custom slug
  name text not null,                       -- display name — editable even for template-seeded roles
  permissions text[] not null default '{}',
  -- Template-seeded roles can be renamed/re-permissioned but not deleted
  -- while any member holds them (same "don't delete a role in use" rule
  -- that applies to custom roles) — this just also protects the built-in
  -- starter set from being removed by accident.
  is_system boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, key)
);
create index if not exists organization_roles_profile_id_idx on organization_roles (profile_id);

-- ============================================================================
-- 2. MEMBERSHIP — one row per person added to an organization beyond its
--    owner. A person keeps exactly one Ringo account no matter how many
--    organizations they belong to (user_id always points at their one
--    public.users row); `status` controls workspace access without ever
--    touching that account, its profile, or its history elsewhere.
-- ============================================================================
create table if not exists organization_members (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role_id uuid not null references organization_roles(id),
  status text not null default 'active' check (status in ('active', 'inactive', 'removed')),
  invited_by uuid references public.users(id),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per (organization, person) — prevents duplicate membership
  -- outright rather than only for 'active' status, so removing then
  -- re-inviting the same person updates their existing row instead of
  -- creating a second one.
  unique (profile_id, user_id)
);
create index if not exists organization_members_profile_id_idx on organization_members (profile_id, status);
create index if not exists organization_members_user_id_idx on organization_members (user_id, status);

-- ============================================================================
-- 3. INVITATIONS — both invitation methods (manager enters details / secure
--    link) create exactly one row here; they differ only in `method` and
--    whether invitee_* is pre-filled. Only a SHA-256 hash of the token is
--    ever stored — the raw token exists solely in the URL shown once at
--    creation time (and whatever channel the manager pastes it into), never
--    logged or persisted in full. Default single-use: accepting flips
--    status to 'accepted', and an accepted/expired/revoked/cancelled token
--    can never create a membership again (enforced in the accept route,
--    which re-checks status + expiry against the current row before
--    writing anything).
-- ============================================================================
create table if not exists organization_invitations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  role_id uuid not null references organization_roles(id),
  invited_by uuid not null references public.users(id),
  method text not null check (method in ('manual', 'link')),
  invitee_name text,
  invitee_email text,
  invitee_phone text,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked', 'cancelled')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists organization_invitations_profile_id_idx on organization_invitations (profile_id, status);
create index if not exists organization_invitations_token_hash_idx on organization_invitations (token_hash);

-- ============================================================================
-- 4. ACTIVITY LOG — team-management actions only (invited, link generated,
--    revoked, accepted, role changed, permissions changed, deactivated,
--    removed, custom role created/modified/deleted). Distinct from
--    admin_audit_log (platform-admin-only actions) — this is
--    organization-scoped and readable by that organization's own
--    authorized staff, not just Ringo admins.
-- ============================================================================
create table if not exists organization_activity_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  actor_user_id uuid references public.users(id),
  action text not null,
  target_user_id uuid references public.users(id),
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists organization_activity_log_profile_id_idx on organization_activity_log (profile_id, created_at desc);

-- ============================================================================
-- PERMISSION HELPERS — the one place "does this caller have permission X on
-- this organization" is defined, so RLS and application code never
-- duplicate (and never drift out of sync on) this logic.
-- ============================================================================

-- True for the organization's owner, any Ringo platform admin, or any
-- active member regardless of their specific permissions — the baseline
-- "does this person belong here at all" check (e.g. can they see the
-- organization's own profile/branding while working inside it).
create or replace function is_org_member(p_profile_id uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from profiles p where p.id = p_profile_id and p.user_id = auth.uid())
    or is_admin()
    or exists (
      select 1 from organization_members m
      where m.profile_id = p_profile_id and m.user_id = auth.uid() and m.status = 'active'
    );
$$;

-- True for the organization's owner, any Ringo platform admin, or an active
-- member whose role grants the specific permission string. Never trusts a
-- permission list from the client — always re-derives it from
-- organization_members -> organization_roles for the authenticated caller
-- (auth.uid()), which is exactly what makes this safe to call from RLS.
create or replace function has_org_permission(p_profile_id uuid, p_permission text) returns boolean
language sql security definer stable as $$
  select exists (select 1 from profiles p where p.id = p_profile_id and p.user_id = auth.uid())
    or is_admin()
    or exists (
      select 1 from organization_members m
      join organization_roles r on r.id = m.role_id
      where m.profile_id = p_profile_id and m.user_id = auth.uid() and m.status = 'active'
        and p_permission = any(r.permissions)
    );
$$;

-- ============================================================================
-- RLS — new tables
-- ============================================================================
alter table organization_roles enable row level security;
alter table organization_members enable row level security;
alter table organization_invitations enable row level security;
alter table organization_activity_log enable row level security;

do $$
begin
  -- Roles: any active member (or owner/admin) can see the role list —
  -- needed so someone can see their own role's name/permissions, and so
  -- the Team page can render "who has what." Only staff.manage holders (or
  -- owner/admin) can write. Fine-grained rules this coarse check can't
  -- express by itself — a manager can't grant permissions they don't hold,
  -- can't delete a role currently assigned, can't touch the implicit
  -- owner — are enforced in the API routes (src/app/api/team/roles/*),
  -- which is also where every write actually happens; this policy is the
  -- backstop, not the only line of defense.
  if not exists (select 1 from pg_policies where tablename = 'organization_roles' and policyname = 'organization_roles read') then
    create policy "organization_roles read" on organization_roles for select using (is_org_member(profile_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'organization_roles' and policyname = 'organization_roles write') then
    create policy "organization_roles write" on organization_roles for all using (
      has_org_permission(profile_id, 'staff.manage')
    ) with check (
      has_org_permission(profile_id, 'staff.manage')
    );
  end if;

  -- Members: staff.view holders (or owner/admin) can list the team; anyone
  -- can see their own membership row (so their own dashboard can resolve
  -- "which organizations am I part of, with what role"). Writes
  -- (role/status changes) need staff.manage — self-escalation and
  -- above-own-level edits are rejected in the API route, same reasoning as
  -- organization_roles above. There is deliberately no INSERT policy: a
  -- membership row is only ever created by the invitation-accept route
  -- using the service-role client, after that route has independently
  -- verified the invitation token — never by a direct client-side insert.
  if not exists (select 1 from pg_policies where tablename = 'organization_members' and policyname = 'organization_members read') then
    create policy "organization_members read" on organization_members for select using (
      has_org_permission(profile_id, 'staff.view') or user_id = auth.uid()
    );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'organization_members' and policyname = 'organization_members write') then
    create policy "organization_members write" on organization_members for update using (
      has_org_permission(profile_id, 'staff.manage')
    ) with check (
      has_org_permission(profile_id, 'staff.manage')
    );
  end if;

  -- Invitations: staff.invite holders (or owner/admin) can create/list/
  -- revoke. No SELECT policy grants access to an unauthenticated invitee —
  -- that's intentional: accepting an invitation goes through
  -- /api/team/invitations/accept using the service-role client, which
  -- looks the row up by the hashed token itself. A recipient who isn't yet
  -- an organization member has no RLS path to this table at all, so they
  -- can't enumerate or read other invitations.
  if not exists (select 1 from pg_policies where tablename = 'organization_invitations' and policyname = 'organization_invitations read') then
    create policy "organization_invitations read" on organization_invitations for select using (
      has_org_permission(profile_id, 'staff.invite')
    );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'organization_invitations' and policyname = 'organization_invitations insert') then
    create policy "organization_invitations insert" on organization_invitations for insert with check (
      has_org_permission(profile_id, 'staff.invite') and invited_by = auth.uid()
    );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'organization_invitations' and policyname = 'organization_invitations update') then
    create policy "organization_invitations update" on organization_invitations for update using (
      has_org_permission(profile_id, 'staff.invite')
    ) with check (
      has_org_permission(profile_id, 'staff.invite')
    );
  end if;

  -- Activity log: staff.view holders (or owner/admin) can read; any active
  -- member can insert an entry for their OWN action (actor_user_id must be
  -- themselves) so the log stays complete even for actions a staff.manage
  -- holder (not just the owner) performs — e.g. a manager inviting someone.
  if not exists (select 1 from pg_policies where tablename = 'organization_activity_log' and policyname = 'organization_activity_log read') then
    create policy "organization_activity_log read" on organization_activity_log for select using (
      has_org_permission(profile_id, 'staff.view')
    );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'organization_activity_log' and policyname = 'organization_activity_log insert') then
    create policy "organization_activity_log insert" on organization_activity_log for insert with check (
      is_org_member(profile_id) and (actor_user_id = auth.uid() or actor_user_id is null)
    );
  end if;
end $$;

-- ============================================================================
-- RLS — staff access to the organization's own `profiles` row. Purely
-- additive (see the design note at the top): the existing "profiles are
-- publicly readable" / "profiles update by owner or admin" policies are
-- untouched; these just extend the same access to permitted staff.
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'profiles staff read') then
    create policy "profiles staff read" on profiles for select using (is_org_member(id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'profiles staff settings update') then
    create policy "profiles staff settings update" on profiles for update using (
      has_org_permission(id, 'settings.manage')
    ) with check (
      has_org_permission(id, 'settings.manage')
    );
  end if;
end $$;

-- ============================================================================
-- RLS — Restaurant & Food (reference category — see the final report for
-- what extending another category the same way involves). Every policy
-- below is additive alongside that category's existing "owner all"/
-- "owner write" policies from 2026-09-15_restaurant_food.sql.
-- ============================================================================
do $$
begin
  -- Menu: viewing is already public (menu_categories/menu_items "public
  -- read" policies) — staff only need a write path, gated on menu.manage.
  if not exists (select 1 from pg_policies where tablename = 'menu_categories' and policyname = 'menu_categories staff write') then
    create policy "menu_categories staff write" on menu_categories for all using (
      has_org_permission(profile_id, 'menu.manage')
    ) with check (
      has_org_permission(profile_id, 'menu.manage')
    );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'menu_items' and policyname = 'menu_items staff write') then
    create policy "menu_items staff write" on menu_items for all using (
      has_org_permission(profile_id, 'menu.manage')
    ) with check (
      has_org_permission(profile_id, 'menu.manage')
    );
  end if;

  -- Tables/QR — not publicly listable, so staff need an explicit read path
  -- too (tables.view), plus manage for create/edit/enable/disable.
  if not exists (select 1 from pg_policies where tablename = 'restaurant_tables' and policyname = 'restaurant_tables staff read') then
    create policy "restaurant_tables staff read" on restaurant_tables for select using (
      has_org_permission(profile_id, 'tables.view') or has_org_permission(profile_id, 'tables.manage')
    );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'restaurant_tables' and policyname = 'restaurant_tables staff manage') then
    create policy "restaurant_tables staff manage" on restaurant_tables for all using (
      has_org_permission(profile_id, 'tables.manage')
    ) with check (
      has_org_permission(profile_id, 'tables.manage')
    );
  end if;

  -- Customers + marketing consent — read-mostly for staff (customers.view);
  -- the record itself is written by the guest-ordering server route via
  -- the service-role client, not by staff directly.
  if not exists (select 1 from pg_policies where tablename = 'restaurant_customers' and policyname = 'restaurant_customers staff read') then
    create policy "restaurant_customers staff read" on restaurant_customers for select using (
      has_org_permission(profile_id, 'customers.view')
    );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'customer_marketing_consent' and policyname = 'customer_marketing_consent staff read') then
    create policy "customer_marketing_consent staff read" on customer_marketing_consent for select using (
      exists (
        select 1 from restaurant_customers c
        where c.id = customer_id and has_org_permission(c.profile_id, 'customers.view')
      )
    );
  end if;

  -- Orders — split read (orders.view; also implied by kitchen.view, since
  -- the Kitchen board is just a filtered order view) from write
  -- (orders.update, e.g. advancing status) rather than one blanket policy,
  -- so a Cashier (orders.view + payments.view + sales.view, no
  -- orders.update) can see orders without being able to change them.
  if not exists (select 1 from pg_policies where tablename = 'orders' and policyname = 'orders staff read') then
    create policy "orders staff read" on orders for select using (
      has_org_permission(profile_id, 'orders.view') or has_org_permission(profile_id, 'kitchen.view')
    );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'orders' and policyname = 'orders staff update') then
    create policy "orders staff update" on orders for update using (
      has_org_permission(profile_id, 'orders.update') or has_org_permission(profile_id, 'kitchen.update')
    ) with check (
      has_org_permission(profile_id, 'orders.update') or has_org_permission(profile_id, 'kitchen.update')
    );
  end if;
  -- Sales/reports/analytics/payments all read from `orders` directly today
  -- (see the design note in 2026-09-15_restaurant_food.sql: there's no
  -- separate receipts/sales table) — granting read access via any of these
  -- permissions is what actually lets a Cashier/Accountant see totals
  -- without also granting orders.update.
  if not exists (select 1 from pg_policies where tablename = 'orders' and policyname = 'orders staff read financial') then
    create policy "orders staff read financial" on orders for select using (
      has_org_permission(profile_id, 'sales.view')
      or has_org_permission(profile_id, 'payments.view')
      or has_org_permission(profile_id, 'reports.view')
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'order_items' and policyname = 'order_items staff read') then
    create policy "order_items staff read" on order_items for select using (
      exists (
        select 1 from orders o where o.id = order_id and (
          has_org_permission(o.profile_id, 'orders.view')
          or has_org_permission(o.profile_id, 'kitchen.view')
          or has_org_permission(o.profile_id, 'sales.view')
          or has_org_permission(o.profile_id, 'reports.view')
        )
      )
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'order_status_history' and policyname = 'order_status_history staff read') then
    create policy "order_status_history staff read" on order_status_history for select using (
      exists (
        select 1 from orders o where o.id = order_id and (
          has_org_permission(o.profile_id, 'orders.view') or has_org_permission(o.profile_id, 'kitchen.view')
        )
      )
    );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'order_status_history' and policyname = 'order_status_history staff insert') then
    create policy "order_status_history staff insert" on order_status_history for insert with check (
      exists (
        select 1 from orders o where o.id = order_id and (
          has_org_permission(o.profile_id, 'orders.update') or has_org_permission(o.profile_id, 'kitchen.update')
        )
      )
    );
  end if;
end $$;
