-- Ringo Protection — Phase 1: data model, append-only ledger, admin configuration ONLY.
--
-- This is a dormant foundation. Nothing in this migration is reachable from checkout, Fapshi, or
-- any customer/seller-facing surface: no application code writes to these tables yet.
-- protection_enabled defaults to false and no code path reads it. A protected transaction cannot
-- be created by anything in the current app.
--
-- Design reference: the "Ringo Protection — Phase 1" architecture review (this session). Key
-- rule this migration exists to enforce structurally, not just by convention: a protected
-- transaction must NEVER create a commerce_sale_earnings row before release — that table's own
-- guard trigger and every existing reader (including the payout RPC's eligibility query) already
-- assume every unreversed row there is real, payable seller money. Protection therefore sits
-- entirely upstream of commerce_sale_earnings, in its own tables, untouched by this migration.
--
-- Polymorphic order reference (target_type/target_id, no FK) mirrors the SAME pattern
-- customer_payments already uses for exactly this reason (product_order today; a future vertical
-- adds another value to the check list, not a new column) — this is "the project's own equivalent
-- abstraction" for a reusable engine, not a new pattern invented for this feature.
--
-- Additive/idempotent throughout, same convention as every migration since 2026-09-12.

-- ============================================================================
-- 1. PLATFORM SETTINGS — Ringo Protection policy. Mirrors the commerce_enabled /
--    commerce_commission_rate precedent exactly: the master switch defaults false, and the fee
--    rate has NO default (null = not configured) — never a guessed percentage. Auto-release hours
--    is the one setting Phase 1 gives a real, immediately-usable default to (48h), since it's
--    inert while protection_enabled is false and every other admin-configurable hold/window in
--    this schema (music_payout_hold_days, affiliate_hold_days, commerce_payout_hold_days) already
--    ships with a real default rather than null.
-- ============================================================================
alter table platform_settings add column if not exists protection_enabled boolean not null default false;
alter table platform_settings add column if not exists protection_fee_rate numeric(5,4);
alter table platform_settings add column if not exists protection_auto_release_hours int not null default 48;

-- ============================================================================
-- 2. PROTECTION TRANSACTIONS — one row per protected order, permanently snapshotting the
--    configuration used at creation time. Every financial/identity column is frozen after insert
--    by the guard trigger below; only status and its own lifecycle timestamps may change.
--
--    No transition-legality check is encoded in the guard trigger (unlike product_orders_guard,
--    which enforces one) — Phase 1 deliberately does not implement release/refund/dispute
--    functions yet, so encoding their transition graph now would be guesswork. That check belongs
--    in the same future migration that adds the transition functions themselves, exactly how
--    product_orders_guard's own transition table was authored alongside create_product_order().
--
--    No dispute_id column yet: no disputes table exists to reference, and an FK-less placeholder
--    column would be meaningless. Add it additively (a single nullable column) in the phase that
--    builds disputes.
-- ============================================================================
create table if not exists protection_transactions (
  id uuid primary key default gen_random_uuid(),

  -- Polymorphic order reference — see the migration header. Only 'product_order' is legal today.
  target_type text not null check (target_type in ('product_order')),
  target_id uuid not null,

  profile_id uuid not null references profiles(id) on delete restrict,
  -- The profile owner — same identity commerce_sale_earnings.creator_user_id already uses, so the
  -- eventual release hand-off can create a commerce_sale_earnings row with zero identity mapping.
  creator_user_id uuid not null references public.users(id) on delete restrict,
  -- Nullable: a protected purchase, like a normal one, may be a guest checkout.
  customer_id uuid references ringo_customers(id) on delete set null,

  currency text not null check (currency = upper(currency) and char_length(currency) = 3),

  -- The snapshot. Permanently frozen by the guard trigger — an admin changing today's platform
  -- settings must never alter an existing transaction's own recorded numbers.
  product_amount numeric(12,2) not null check (product_amount > 0),
  protection_fee_rate numeric(5,4) not null check (protection_fee_rate >= 0 and protection_fee_rate <= 1),
  protection_fee_amount numeric(12,2) not null check (protection_fee_amount >= 0),
  customer_total numeric(12,2) not null check (customer_total > 0),
  seller_protected_amount numeric(12,2) not null check (seller_protected_amount > 0),
  check (customer_total = product_amount + protection_fee_amount),
  check (seller_protected_amount = product_amount),

  status text not null default 'awaiting_payment' check (status in (
    'awaiting_payment', 'protected', 'fulfillment_started', 'awaiting_confirmation',
    'released', 'disputed', 'resolved_release', 'resolved_refund',
    'refunded', 'cancelled', 'expired', 'payment_failed'
  )),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz,
  auto_release_at timestamptz,

  unique (target_type, target_id)
);
create index if not exists protection_transactions_creator_user_id_idx on protection_transactions (creator_user_id, status);
create index if not exists protection_transactions_profile_id_idx on protection_transactions (profile_id, status);
create index if not exists protection_transactions_status_idx on protection_transactions (status, created_at);

create or replace function protection_transactions_guard() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.target_type <> old.target_type or new.target_id <> old.target_id
     or new.profile_id <> old.profile_id or new.creator_user_id <> old.creator_user_id
     or new.customer_id is distinct from old.customer_id
     or new.currency <> old.currency
     or new.product_amount <> old.product_amount or new.protection_fee_rate <> old.protection_fee_rate
     or new.protection_fee_amount <> old.protection_fee_amount or new.customer_total <> old.customer_total
     or new.seller_protected_amount <> old.seller_protected_amount
     or new.created_at <> old.created_at then
    raise exception 'protection_transactions: immutable column changed';
  end if;
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists protection_transactions_guard_trg on protection_transactions;
create trigger protection_transactions_guard_trg before update on protection_transactions
  for each row execute function protection_transactions_guard();

-- ============================================================================
-- 3. PROTECTION LEDGER — append-only financial event log. No release/refund logic writes to this
--    yet (Phase 1 adds no functions that ever insert an event); the table exists so the schema is
--    ready. Truly append-only: the guard trigger below rejects every UPDATE and DELETE
--    unconditionally, so a "current balance" can never be edited in place — it can only ever be
--    reconstructed by summing entries, which is the whole point.
-- ============================================================================
create table if not exists protection_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  protection_transaction_id uuid not null references protection_transactions(id) on delete restrict,
  event_type text not null check (event_type in ('charge', 'release', 'refund', 'fee_recognized')),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency = upper(currency) and char_length(currency) = 3),
  -- e.g. a Fapshi transaction id or a payout id, once a future phase writes one. Nullable: not
  -- every event type will have an external reference.
  reference text,
  metadata jsonb,
  -- Lets a future writer insert with `on conflict (idempotency_key) do nothing` — safe by
  -- construction against a retried release/refund attempt creating a duplicate event. Nullable
  -- and partially-unique: most rows won't need one.
  idempotency_key text,
  created_at timestamptz not null default now()
);
create index if not exists protection_ledger_entries_txn_idx on protection_ledger_entries (protection_transaction_id, created_at);
create unique index if not exists protection_ledger_entries_idempotency_idx
  on protection_ledger_entries (idempotency_key) where idempotency_key is not null;

create or replace function protection_ledger_entries_guard() returns trigger language plpgsql as $$
begin
  raise exception 'protection_ledger_entries: append-only, rows can never be changed or removed';
  return null;
end $$;
drop trigger if exists protection_ledger_entries_no_update_trg on protection_ledger_entries;
create trigger protection_ledger_entries_no_update_trg before update on protection_ledger_entries
  for each row execute function protection_ledger_entries_guard();
drop trigger if exists protection_ledger_entries_no_delete_trg on protection_ledger_entries;
create trigger protection_ledger_entries_no_delete_trg before delete on protection_ledger_entries
  for each row execute function protection_ledger_entries_guard();

-- ============================================================================
-- ROW LEVEL SECURITY — restrictive by design: nothing here is writable by anon or authenticated
-- today, on purpose, since no server-side transition function exists yet to be the sole writer.
-- protection_transactions: owner (seller) or admin may READ their own rows, matching
-- commerce_sale_earnings' own "owner read" policy exactly. protection_ledger_entries has NO
-- authenticated policy at all (admin/service-role only) — a seller doesn't need raw ledger
-- events, only their own transaction's snapshot/status, already available via the table above.
-- ============================================================================
alter table protection_transactions enable row level security;
alter table protection_ledger_entries enable row level security;

revoke all on protection_transactions, protection_ledger_entries from anon, authenticated;
grant select, insert, update, delete on protection_transactions, protection_ledger_entries to service_role;
grant select on protection_transactions to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'protection_transactions' and policyname = 'protection_transactions owner read') then
    create policy "protection_transactions owner read" on protection_transactions for select to authenticated using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin())));
  end if;
end $$;

-- Rollback notes (manual, not executed):
--   drop trigger if exists protection_ledger_entries_no_delete_trg on protection_ledger_entries;
--   drop trigger if exists protection_ledger_entries_no_update_trg on protection_ledger_entries;
--   drop function if exists protection_ledger_entries_guard();
--   drop trigger if exists protection_transactions_guard_trg on protection_transactions;
--   drop function if exists protection_transactions_guard();
--   drop table if exists protection_ledger_entries;
--   drop table if exists protection_transactions;
--   alter table platform_settings drop column if exists protection_auto_release_hours;
--   alter table platform_settings drop column if exists protection_fee_rate;
--   alter table platform_settings drop column if exists protection_enabled;
