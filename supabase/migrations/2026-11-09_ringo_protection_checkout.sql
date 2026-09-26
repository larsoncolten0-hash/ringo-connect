-- Ringo Protection — Phase 4: checkout/payment data model ONLY. Additive on top of Phase 1
-- (protection_transactions, dormant) and Phase 2 (transitionProtectionTransaction engine, dormant
-- until now). No previous migration is modified — this file only adds a new table.
--
-- Why a NEW table instead of widening customer_payments.target_type:
--   customer_payments.target_type is check-constrained to ('product_order') and its settlement
--   logic (settlement.ts) requires payment.amount === product_orders.total exactly — Protection
--   charges product_amount + protection_fee_amount, which would fail that match unconditionally.
--   Reusing it would also mean altering an existing CHECK constraint on a table Normal Payment
--   depends on. Per the project's additive-only rule, a dedicated table is the correct, zero-touch
--   path — the same reasoning protection_refunds (Phase 3) already applied by NOT reusing
--   commerce_sale_earnings. Named protection_transaction_id (a real FK, not the polymorphic
--   target_type/target_id customer_payments uses) because — like protection_refunds before it —
--   this table only ever has one legal target, so polymorphism buys nothing here.
--
-- Structurally this is customer_payments' own shape, minus the polymorphism it doesn't need: same
-- status vocabulary, same one-live-attempt discipline, same guard trigger shape, same RLS posture
-- (server/service-role only — a customer never has direct table access to their own payment attempt,
-- exactly like customer_payments today).
--
-- Additive/idempotent throughout, same convention as every migration since 2026-09-12.

-- ============================================================================
-- PROTECTION PAYMENTS — one row per Fapshi charge attempt for a protection_transactions row.
-- Multiple rows per transaction are legal (retry after failure/expiry), but at most ONE live
-- (initiated/pending) at a time — enforced by the partial unique index below, exactly like
-- customer_payments_one_live_idx.
-- ============================================================================
create table if not exists protection_payments (
  id uuid primary key default gen_random_uuid(),
  protection_transaction_id uuid not null references protection_transactions(id) on delete restrict,

  provider text not null default 'fapshi' check (provider in ('fapshi')),
  provider_transaction_id text,
  external_id text not null unique,               -- reference sent to Fapshi; one per attempt

  profile_id uuid not null references profiles(id) on delete restrict,
  customer_id uuid references ringo_customers(id) on delete set null,

  -- The FULL amount charged to the customer: product_amount + protection_fee_amount (snapshotted on
  -- the parent protection_transactions row). Never recomputed here — always read from the parent.
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency = upper(currency) and char_length(currency) = 3),
  payer_medium text check (payer_medium in ('mobile money','orange money')),

  status text not null default 'initiated'
    check (status in ('initiated','pending','succeeded','failed','expired','cancelled')),
  provider_status text,
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),

  expires_at timestamptz not null,
  confirmed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'succeeded' or confirmed_at is not null)
);
create unique index if not exists protection_payments_provider_txn_idx
  on protection_payments (provider, provider_transaction_id) where provider_transaction_id is not null;
create unique index if not exists protection_payments_one_live_idx
  on protection_payments (protection_transaction_id) where status in ('initiated','pending');
create index if not exists protection_payments_txn_idx on protection_payments (protection_transaction_id, created_at desc);
create index if not exists protection_payments_live_expiry_idx on protection_payments (expires_at) where status in ('initiated','pending');

-- ============================================================================
-- GUARD — same shape as customer_payments_guard: identity/amount columns frozen after insert,
-- legal status transitions only. Transition graph mirrors customer_payments' own exactly (including
-- the two "late confirmation after local expiry/cancellation" edges), since it is the same kind of
-- attempt/intent record.
-- ============================================================================
create or replace function protection_payments_guard() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.protection_transaction_id <> old.protection_transaction_id
     or new.provider <> old.provider or new.external_id <> old.external_id
     or new.profile_id <> old.profile_id or new.amount <> old.amount or new.currency <> old.currency
     or new.expires_at <> old.expires_at or new.created_at <> old.created_at
     or (old.provider_transaction_id is not null and new.provider_transaction_id is distinct from old.provider_transaction_id) then
    raise exception 'protection_payments: immutable column changed';
  end if;
  if new.status <> old.status and not (
        (old.status = 'initiated' and new.status in ('pending','succeeded','failed','expired','cancelled'))
     or (old.status = 'pending'   and new.status in ('succeeded','failed','expired','cancelled'))
     or (old.status = 'expired'   and new.status = 'succeeded')
     or (old.status = 'cancelled' and new.status = 'succeeded')) then
    raise exception 'protection_payments: illegal status transition % -> %', old.status, new.status;
  end if;
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists protection_payments_guard_trg on protection_payments;
create trigger protection_payments_guard_trg before update on protection_payments
  for each row execute function protection_payments_guard();

-- ============================================================================
-- ROW LEVEL SECURITY — server/service-role only, exactly like customer_payments: no authenticated
-- or anon policy at all. A customer's own payment status is surfaced only through the
-- already-existing protection_transactions "owner read" policy (Phase 1) and the pay-status API
-- route, never by direct table access to payment attempts (provider references, failure text).
-- ============================================================================
alter table protection_payments enable row level security;
revoke all on protection_payments from anon, authenticated;
grant select, insert, update, delete on protection_payments to service_role;

-- Rollback notes (manual, not executed):
--   drop trigger if exists protection_payments_guard_trg on protection_payments;
--   drop function if exists protection_payments_guard();
--   drop table if exists protection_payments;
