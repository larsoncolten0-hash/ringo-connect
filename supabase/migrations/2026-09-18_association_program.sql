-- Association Program — a loyalty/points network with an Owner, Partners
-- (businesses with their OWN real Ringo profile), and Members (individuals
-- with no public Ringo page of their own). Entirely new subsystem, isolated
-- from every existing category. See the investigation report this migration
-- was built from for the full reasoning; the short version of each decision
-- is repeated inline below so this file stands on its own.
--
-- PURELY ADDITIVE — confirmed against the live schema (not just the tracked
-- migrations, which are known to lag it) before writing this file. Nothing
-- below drops, renames, repurposes, or changes the behavior of any existing
-- table, column, row, function, or policy. Every new table is genuinely new;
-- `ringo_cards` and `plans` only gain new nullable/defaulted columns (and, for
-- `plans`, new rows) — every existing row and every existing column's
-- existing meaning is untouched.
--
-- WHY NOT REUSE organization_members/organization_invitations (Team &
-- Organization): that schema assumes every "member" is a complete Ringo
-- account being granted STAFF PERMISSIONS over the owner's own data
-- (organization_members.user_id -> a real profiles row, has_org_permission
-- checks). Partners here are the OPPOSITE relationship — two independent
-- businesses networked together, neither with permissions over the other's
-- data — and Members have no profile at all, a shape that table has no way
-- to express. Same underlying pattern (owner + token-hashed invitations),
-- genuinely new tables.
--
-- Additive/idempotent throughout, same convention as every migration since
-- 2026-09-12: safe to re-run.

-- ============================================================================
-- 1. ASSOCIATION PARTNERS — a Partner is an existing, independent `profiles`
--    row that has been linked into an Association. Deliberately a join table
--    between two profiles, not a role/staff table: a Partner keeps full,
--    unchanged ownership and control of their own page/data; this table only
--    records that the link exists, plus the one piece of data specific to
--    that link (their MoMo number for THIS Association's context).
-- ============================================================================
create table if not exists association_partners (
  id uuid primary key default gen_random_uuid(),
  association_profile_id uuid not null references profiles(id) on delete cascade,
  partner_profile_id uuid not null references profiles(id) on delete cascade,
  -- Where a Member pays this Partner directly (see PAYMENT note on
  -- association_settings below) — specific to this Association context,
  -- deliberately not read from the Partner's own profile fields, since a
  -- business's payout number for one Association's members may differ from
  -- their own public WhatsApp/contact number.
  momo_number text,
  status text not null default 'active' check (status in ('active', 'removed')),
  invited_by uuid references public.users(id),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (association_profile_id, partner_profile_id)
);
create index if not exists association_partners_association_idx on association_partners (association_profile_id, status);
create index if not exists association_partners_partner_idx on association_partners (partner_profile_id, status);

-- ============================================================================
-- 2. ASSOCIATION INVITATIONS — Partner linking, modeled directly on
--    organization_invitations: a random token, only its SHA-256 hash ever
--    stored, single-use, re-validated server-side on accept. Unlike a Team
--    invite (which may target someone with no account yet), a Partner must
--    already be a real Ringo user with their own profile — invitee_profile_id
--    is resolved (by username/phone search) and stored at invite-creation
--    time, so an invitation is bound to one real profile from the start, not
--    ambiguous free text. invitee_username/invitee_phone are kept alongside
--    purely as a record of what the Owner searched for.
-- ============================================================================
create table if not exists association_invitations (
  id uuid primary key default gen_random_uuid(),
  association_profile_id uuid not null references profiles(id) on delete cascade,
  invited_by uuid not null references public.users(id),
  method text not null check (method in ('manual', 'link')),
  invitee_profile_id uuid references profiles(id),
  invitee_username text,
  invitee_phone text,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked', 'cancelled')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists association_invitations_association_idx on association_invitations (association_profile_id, status);
create index if not exists association_invitations_token_hash_idx on association_invitations (token_hash);

-- ============================================================================
-- 3. ASSOCIATION MEMBERS — a lightweight, standalone identity. Never a copy
--    of profiles/users data: name + phone entered directly by the Owner.
--    linked_profile_id is OPTIONAL and never automatic (per product decision)
--    — set only if the Owner deliberately searches for and links an existing
--    Ringo account; most rows will have it null, and the feature works fully
--    either way. access_token_hash powers the Member's own no-login view
--    (see /community/manage/[token] for the existing precedent this mirrors)
--    — hashed the same way invitation tokens are, for the same reason.
-- ============================================================================
create table if not exists association_members (
  id uuid primary key default gen_random_uuid(),
  association_profile_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  phone text,
  linked_profile_id uuid references profiles(id) on delete set null,
  points_balance int not null default 0,
  status text not null default 'active' check (status in ('active', 'disabled')),
  access_token_hash text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Prevents accidentally linking the same real account twice within one
  -- Association. Postgres treats each NULL as distinct, so this never
  -- restricts the (overwhelmingly common) unlinked case.
  unique (association_profile_id, linked_profile_id)
);
create index if not exists association_members_association_idx on association_members (association_profile_id, status);

-- ============================================================================
-- 4. ASSOCIATION REWARDS — the Owner's redeemable catalog. Plural point
--    costs, not one fixed rate (distinct from the earn-side rate below).
-- ============================================================================
create table if not exists association_rewards (
  id uuid primary key default gen_random_uuid(),
  association_profile_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  description text,
  points_cost int not null check (points_cost > 0),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists association_rewards_association_idx on association_rewards (association_profile_id, active, sort_order);

-- ============================================================================
-- 5. ASSOCIATION POINT TRANSACTIONS — append-only ledger. Every row is
--    written exclusively by the two RPCs in section 7 below (never a direct
--    client insert — see RLS in section 8), so this table is always a
--    faithful audit trail of every earn/redeem, for the Owner, Partner, and
--    Member views plus the monthly CSV export.
-- ============================================================================
create table if not exists association_point_transactions (
  id uuid primary key default gen_random_uuid(),
  association_profile_id uuid not null references profiles(id) on delete cascade,
  member_id uuid not null references association_members(id) on delete cascade,
  -- Null means the Owner logged this directly rather than a Partner.
  partner_profile_id uuid references profiles(id),
  type text not null check (type in ('earn', 'redeem')),
  -- Purchase amount, earn only. Null for redeem (a reward's cost is points,
  -- not currency).
  amount_xaf numeric,
  -- Positive for earn, negative for redeem — the balance is just this
  -- column's running sum, so it can never drift from the transaction log.
  points_delta int not null,
  -- Which reward was redeemed, redeem only.
  reward_id uuid references association_rewards(id),
  created_at timestamptz not null default now()
);
create index if not exists association_point_transactions_association_idx on association_point_transactions (association_profile_id, created_at desc);
create index if not exists association_point_transactions_member_idx on association_point_transactions (member_id, created_at desc);
create index if not exists association_point_transactions_partner_idx on association_point_transactions (partner_profile_id, created_at desc);

-- ============================================================================
-- 6. ASSOCIATION SETTINGS — one row per Association: the Owner's
--    points-per-amount earn rate and a default MoMo number (used when a
--    specific Partner hasn't set their own in association_partners).
--
--    PAYMENT NOTE (v1, deliberately simple): this is a "declared payment"
--    display only, same pattern already used for Restaurant orders — the
--    Partner's or this default MoMo number is shown to the Member, who pays
--    it directly. Ringo does not collect this payment and takes no
--    commission. No Fapshi-mediated collection exists anywhere in this
--    feature; nothing here should be extended toward that without a
--    separate, explicit task.
-- ============================================================================
create table if not exists association_settings (
  association_profile_id uuid primary key references profiles(id) on delete cascade,
  points_per_amount numeric not null default 1,
  amount_unit numeric not null default 100,
  default_momo_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 7. RINGO CARDS — extend with new nullable columns only for Member binding.
--    Every existing column keeps its exact existing meaning:
--      * `destination_url` remains EXACTLY what it already is — always
--        server-computed from a profile's username, for profile-bound cards
--        only. The existing computation code for it is never touched.
--      * `member_card_url` is a NEW, separate field for membership cards,
--        computed by new server code and written via the exact same
--        existing Web NFC write function — a parallel path, not a shared one.
--      * `user_id` (not null) simply holds the ASSOCIATION OWNER's own
--        user_id for a membership card (they administratively own the
--        physical card) — this needs no schema change at all, and means the
--        existing "owner all" RLS policy already grants the Owner correct
--        access to membership cards with zero policy changes.
--    The new check constraint is the one genuinely new piece of enforcement:
--    a card can be bound to a profile OR a Member, never both — permanent
--    insurance for the "one card, one unambiguous meaning" rule, confirmed
--    non-destructive since every existing row has association_member_id
--    null today.
-- ============================================================================
alter table ringo_cards add column if not exists association_member_id uuid references association_members(id) on delete set null;
alter table ringo_cards add column if not exists member_card_url text;
create index if not exists ringo_cards_association_member_id_idx on ringo_cards (association_member_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ringo_cards_single_binding_check'
  ) then
    alter table ringo_cards add constraint ringo_cards_single_binding_check
      check (profile_id is null or association_member_id is null);
  end if;
end $$;

-- ============================================================================
-- 8. PLANS — extend with new nullable/defaulted capacity columns, same
--    treatment `max_team_seats`/`team_enabled` already got for Business Pro/
--    Basic. Every existing row's shape and every existing column's meaning
--    is unchanged; these three columns simply default to
--    false/null on all five existing rows.
--
--    Feature defaults on the new rows' PRE-EXISTING columns match Pro/
--    Business Pro (unlimited links/catalog, full analytics, custom theme,
--    etc.) — an Association Owner's own public page should work fully, with
--    the Association capabilities layered on top.
--
--    price_usd/price_usd_yearly below are PLACEHOLDER values, not a real
--    pricing decision — confirmed NOT NULL with no default on the live
--    table, so this INSERT cannot omit them (same situation
--    2026-10-05_new_pricing_structure.sql documented for business_basic).
--    Real USD pricing is a separate, later task.
--
--    The open-ended "Contact us" tier is deliberately NOT a row here — no
--    real plan is granted for it in v1 (just a contact link/form in the UI),
--    so there is nothing yet for a schema row to represent.
-- ============================================================================
alter table plans add column if not exists association_enabled boolean not null default false;
alter table plans add column if not exists max_association_members int;
alter table plans add column if not exists max_association_partners int;

insert into plans (
  name, display_name, max_links, max_products, pixels_enabled, custom_theme_enabled,
  full_analytics_enabled, badge_removed, commerce_enabled, bookings_feature_enabled,
  team_enabled, max_team_seats, commission_rate_override, price_usd, price_xaf,
  price_usd_yearly, price_xaf_yearly, features_en, features_fr,
  association_enabled, max_association_members, max_association_partners
)
select 'association_basic', 'Association Basic', null, null, true, true,
  true, true, true, true,
  false, null, null, 25, 15000,
  250, 150000,
  array[
    'Loyalty points network for your association',
    'Up to 50 Members',
    'Up to 10 Partners',
    'Reward catalog & points rate you control'
  ],
  array[
    'Réseau de fidélité par points pour votre association',
    'Jusqu''à 50 Membres',
    'Jusqu''à 10 Partenaires',
    'Catalogue de récompenses et taux de points que vous contrôlez'
  ],
  true, 50, 10
where not exists (select 1 from plans where name = 'association_basic');

insert into plans (
  name, display_name, max_links, max_products, pixels_enabled, custom_theme_enabled,
  full_analytics_enabled, badge_removed, commerce_enabled, bookings_feature_enabled,
  team_enabled, max_team_seats, commission_rate_override, price_usd, price_xaf,
  price_usd_yearly, price_xaf_yearly, features_en, features_fr,
  association_enabled, max_association_members, max_association_partners
)
select 'association_pro', 'Association Pro', null, null, true, true,
  true, true, true, true,
  false, null, null, 50, 30000,
  500, 300000,
  array[
    'Loyalty points network for your association',
    'Up to 100 Members',
    'Up to 25 Partners',
    'Reward catalog & points rate you control'
  ],
  array[
    'Réseau de fidélité par points pour votre association',
    'Jusqu''à 100 Membres',
    'Jusqu''à 25 Partenaires',
    'Catalogue de récompenses et taux de points que vous contrôlez'
  ],
  true, 100, 25
where not exists (select 1 from plans where name = 'association_pro');

insert into plans (
  name, display_name, max_links, max_products, pixels_enabled, custom_theme_enabled,
  full_analytics_enabled, badge_removed, commerce_enabled, bookings_feature_enabled,
  team_enabled, max_team_seats, commission_rate_override, price_usd, price_xaf,
  price_usd_yearly, price_xaf_yearly, features_en, features_fr,
  association_enabled, max_association_members, max_association_partners
)
select 'association_premium', 'Association Premium', null, null, true, true,
  true, true, true, true,
  false, null, null, 85, 50000,
  850, 500000,
  array[
    'Loyalty points network for your association',
    'Up to 200 Members',
    'Up to 50 Partners',
    'Reward catalog & points rate you control'
  ],
  array[
    'Réseau de fidélité par points pour votre association',
    'Jusqu''à 200 Membres',
    'Jusqu''à 50 Partenaires',
    'Catalogue de récompenses et taux de points que vous contrôlez'
  ],
  true, 200, 50
where not exists (select 1 from plans where name = 'association_premium');

-- ============================================================================
-- 9. ATOMIC RPCs — the "tap card, atomically log a points transaction" model,
--    directly modeled on reserve_event_ticket_type/checkin_ticket. Both are
--    security definer, service_role only, and called from the Partner's
--    normal authenticated dashboard route (NOT a bearer-token scanner layer
--    like the ticket gate scanner — Partners are already signed into their
--    own real accounts). Neither trusts a points value from the client for
--    redemption: the reward's cost is re-read server-side inside the
--    function, never passed in.
-- ============================================================================

-- Earning has no ceiling to guard, so a single UPDATE (balance = balance +
-- points) is already atomic on its own — Postgres locks the row for the
-- statement's duration, so two concurrent earns for the same Member simply
-- serialize, no race possible. Returns null if the Member doesn't belong to
-- the given Association (defense in depth — the caller route already checks
-- this before invoking the RPC).
create or replace function log_association_earn(
  p_association_profile_id uuid,
  p_member_id uuid,
  p_partner_profile_id uuid,
  p_amount_xaf numeric,
  p_points int
) returns association_point_transactions as $$
declare
  v_txn association_point_transactions;
begin
  if p_points is null or p_points < 1 then
    return null;
  end if;

  update association_members
  set points_balance = points_balance + p_points, updated_at = now()
  where id = p_member_id and association_profile_id = p_association_profile_id;

  if not found then
    return null;
  end if;

  insert into association_point_transactions (
    association_profile_id, member_id, partner_profile_id, type, amount_xaf, points_delta
  ) values (
    p_association_profile_id, p_member_id, p_partner_profile_id, 'earn', p_amount_xaf, p_points
  ) returning * into v_txn;

  return v_txn;
end;
$$ language plpgsql security definer set search_path to 'public';

revoke all on function log_association_earn(uuid, uuid, uuid, numeric, int) from public, anon, authenticated;
grant execute on function log_association_earn(uuid, uuid, uuid, numeric, int) to service_role;

-- Redemption DOES need a guarded ceiling check (can't go negative) — same
-- technique as reserve_event_ticket_type: a single UPDATE whose WHERE clause
-- re-checks the balance in the same statement that decrements it. Postgres
-- locks the row for that statement, so a second simultaneous redemption tap
-- for the same Member blocks until the first commits, then re-evaluates the
-- balance against the now-current value — no double-spend race. Returns
-- null (not an exception) if the reward is missing/inactive/wrong
-- Association, or if the balance is insufficient.
create or replace function log_association_redeem(
  p_association_profile_id uuid,
  p_member_id uuid,
  p_partner_profile_id uuid,
  p_reward_id uuid
) returns association_point_transactions as $$
declare
  v_points_cost int;
  v_txn association_point_transactions;
begin
  select points_cost into v_points_cost
  from association_rewards
  where id = p_reward_id and association_profile_id = p_association_profile_id and active;

  if v_points_cost is null then
    return null;
  end if;

  update association_members
  set points_balance = points_balance - v_points_cost, updated_at = now()
  where id = p_member_id
    and association_profile_id = p_association_profile_id
    and points_balance >= v_points_cost;

  if not found then
    return null;
  end if;

  insert into association_point_transactions (
    association_profile_id, member_id, partner_profile_id, type, points_delta, reward_id
  ) values (
    p_association_profile_id, p_member_id, p_partner_profile_id, 'redeem', -v_points_cost, p_reward_id
  ) returning * into v_txn;

  return v_txn;
end;
$$ language plpgsql security definer set search_path to 'public';

revoke all on function log_association_redeem(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function log_association_redeem(uuid, uuid, uuid, uuid) to service_role;

-- ============================================================================
-- 10. PERMISSION HELPERS — same reasoning as is_org_member/has_org_permission:
--     the one place "is this caller the Owner" / "is this caller an active
--     Partner" is defined, so RLS and application code never duplicate (and
--     never drift out of sync on) this logic. No fine-grained permission
--     strings here (unlike Team) — a Partner's capability is binary
--     (active link or not), per the product description.
--
--     All four SECURITY DEFINER functions in this migration (these two, plus
--     the two RPCs above) pin `set search_path to 'public'` — same
--     precedent handle_new_auth_user already sets in this codebase. Without
--     it, a SECURITY DEFINER function resolves unqualified identifiers
--     against whatever search_path the calling session happens to have,
--     which is exactly the kind of thing that must never be left to chance
--     for functions that move points/balance data.
-- ============================================================================
create or replace function is_association_owner(p_association_profile_id uuid) returns boolean
language sql security definer stable set search_path to 'public' as $$
  select exists (
    select 1 from profiles p where p.id = p_association_profile_id and p.user_id = auth.uid()
  ) or is_admin();
$$;

create or replace function is_association_partner(p_association_profile_id uuid) returns boolean
language sql security definer stable set search_path to 'public' as $$
  select exists (
    select 1
    from association_partners ap
    join profiles pp on pp.id = ap.partner_profile_id
    where ap.association_profile_id = p_association_profile_id
      and pp.user_id = auth.uid()
      and ap.status = 'active'
  );
$$;

-- ============================================================================
-- 11. RLS
-- ============================================================================
alter table association_partners enable row level security;
alter table association_invitations enable row level security;
alter table association_members enable row level security;
alter table association_rewards enable row level security;
alter table association_point_transactions enable row level security;
alter table association_settings enable row level security;

do $$
begin
  -- Partners: the Owner sees/manages the full list. A Partner can see their
  -- own link row (so their own dashboard can show their own status/momo
  -- number). Only the Owner can update it (e.g. removing a Partner). There
  -- is deliberately no INSERT policy — a row here is only ever created by
  -- the invitation-accept route using the service-role client, exactly like
  -- organization_members never gets a direct client-side insert.
  if not exists (select 1 from pg_policies where tablename = 'association_partners' and policyname = 'association_partners read') then
    create policy "association_partners read" on association_partners for select using (
      is_association_owner(association_profile_id)
      or exists (select 1 from profiles pp where pp.id = partner_profile_id and pp.user_id = auth.uid())
    );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'association_partners' and policyname = 'association_partners update') then
    create policy "association_partners update" on association_partners for update using (
      is_association_owner(association_profile_id)
    ) with check (
      is_association_owner(association_profile_id)
    );
  end if;

  -- Invitations: Owner only, in and out. No SELECT policy grants an
  -- unauthenticated invitee any access — accepting goes through a
  -- service-role route that looks the row up by the hashed token itself,
  -- same posture as organization_invitations.
  if not exists (select 1 from pg_policies where tablename = 'association_invitations' and policyname = 'association_invitations owner all') then
    create policy "association_invitations owner all" on association_invitations for all using (
      is_association_owner(association_profile_id)
    ) with check (
      is_association_owner(association_profile_id) and invited_by = auth.uid()
    );
  end if;

  -- Members: Owner only via RLS. Partners never get a blanket read policy
  -- here on purpose — a Partner shouldn't be able to list every Member and
  -- their balance by querying this table directly. A Partner's tap-to-log
  -- lookup of ONE specific Member (after physically reading that Member's
  -- card) goes through a service-role API route instead, which separately
  -- confirms is_association_partner before returning anything.
  if not exists (select 1 from pg_policies where tablename = 'association_members' and policyname = 'association_members owner all') then
    create policy "association_members owner all" on association_members for all using (
      is_association_owner(association_profile_id)
    ) with check (
      is_association_owner(association_profile_id)
    );
  end if;

  -- Rewards: non-sensitive catalog data (name/description/cost) — Owner
  -- manages it, active Partners can read it to show during a redemption tap
  -- (analogous to menu items already being publicly readable elsewhere).
  if not exists (select 1 from pg_policies where tablename = 'association_rewards' and policyname = 'association_rewards owner write') then
    create policy "association_rewards owner write" on association_rewards for all using (
      is_association_owner(association_profile_id)
    ) with check (
      is_association_owner(association_profile_id)
    );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'association_rewards' and policyname = 'association_rewards partner read') then
    create policy "association_rewards partner read" on association_rewards for select using (
      is_association_partner(association_profile_id)
    );
  end if;

  -- Point transactions: Owner sees everything. A Partner sees only rows
  -- THEY logged (their own log, per the product description) — never other
  -- Partners' activity. No INSERT/UPDATE/DELETE policy at all: every row is
  -- written exclusively by the two RPCs above via the service-role client,
  -- same "no client-side write path" posture as organization_members.
  if not exists (select 1 from pg_policies where tablename = 'association_point_transactions' and policyname = 'association_point_transactions owner read') then
    create policy "association_point_transactions owner read" on association_point_transactions for select using (
      is_association_owner(association_profile_id)
    );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'association_point_transactions' and policyname = 'association_point_transactions partner read own') then
    create policy "association_point_transactions partner read own" on association_point_transactions for select using (
      exists (select 1 from profiles pp where pp.id = partner_profile_id and pp.user_id = auth.uid())
    );
  end if;

  -- Settings: Owner manages; active Partners can read (points rate + default
  -- MoMo number are needed to run the tap-to-log/payment-display flow).
  if not exists (select 1 from pg_policies where tablename = 'association_settings' and policyname = 'association_settings owner write') then
    create policy "association_settings owner write" on association_settings for all using (
      is_association_owner(association_profile_id)
    ) with check (
      is_association_owner(association_profile_id)
    );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'association_settings' and policyname = 'association_settings partner read') then
    create policy "association_settings partner read" on association_settings for select using (
      is_association_partner(association_profile_id)
    );
  end if;
end $$;
