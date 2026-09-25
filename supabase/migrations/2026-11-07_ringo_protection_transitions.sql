-- Ringo Protection — Phase 2: server-side state machine enforcement + lifecycle event log.
--
-- Still dormant: nothing in this migration is reachable from checkout, Fapshi, or any customer/
-- seller-facing surface. It only strengthens what Phase 1 already shipped (protection_transactions,
-- protection_ledger_entries, protection_enabled=false) — no new charge/release/refund capability,
-- no commerce_sale_earnings interaction.
--
-- This completes something Phase 1's own guard trigger comment explicitly deferred: "No
-- transition-legality check is encoded in the guard trigger... that check belongs in the same
-- future migration that adds the transition functions themselves." This is that migration.
-- `create or replace function` only — the Phase 1 migration FILE itself is untouched.
--
-- protection_transaction_events is a NEW, small, append-only, NON-financial log — deliberately
-- separate from protection_ledger_entries, which Phase 1 scoped to financial events only
-- (event_type check constraint: charge/release/refund/fee_recognized) and which Phase 2 still
-- writes nothing to (no money has moved). This table exists because neither the ledger nor the
-- transaction row itself can answer "what was the PREVIOUS status, who requested this transition,
-- and when" for every transition — the transaction row's guard trigger only ever exposes the
-- CURRENT status plus a few dedicated terminal timestamps (paid_at/released_at/refunded_at), not
-- a full history, and repurposing the financial ledger for non-financial events would violate the
-- exact contract Phase 1 designed it around.
--
-- Additive/idempotent throughout, same convention as every migration since 2026-09-12.

-- ============================================================================
-- 1. PROTECTION TRANSACTION EVENTS — append-only lifecycle/audit log (status transitions only,
--    never money). Mirrors protection_ledger_entries' own append-only guard exactly.
-- ============================================================================
create table if not exists protection_transaction_events (
  id uuid primary key default gen_random_uuid(),
  protection_transaction_id uuid not null references protection_transactions(id) on delete restrict,
  from_status text not null,
  to_status text not null,
  actor_type text not null check (actor_type in ('system', 'seller', 'customer', 'admin')),
  -- Exactly one of these is set, matching actor_type — enforced in application code (engine.ts),
  -- not here, since a DB-level "exactly one of N nullable columns" check reads worse than it helps.
  actor_user_id uuid references public.users(id) on delete set null,
  actor_customer_id uuid references ringo_customers(id) on delete set null,
  reason text,
  -- Lets a retried/duplicated transition REQUEST be recognized as the same request, distinct from
  -- the transition itself already being idempotent by construction (see engine.ts).
  idempotency_key text,
  created_at timestamptz not null default now()
);
create index if not exists protection_transaction_events_txn_idx on protection_transaction_events (protection_transaction_id, created_at);
create unique index if not exists protection_transaction_events_idempotency_idx
  on protection_transaction_events (idempotency_key) where idempotency_key is not null;

create or replace function protection_transaction_events_guard() returns trigger language plpgsql as $$
begin
  raise exception 'protection_transaction_events: append-only, rows can never be changed or removed';
  return null;
end $$;
drop trigger if exists protection_transaction_events_no_update_trg on protection_transaction_events;
create trigger protection_transaction_events_no_update_trg before update on protection_transaction_events
  for each row execute function protection_transaction_events_guard();
drop trigger if exists protection_transaction_events_no_delete_trg on protection_transaction_events;
create trigger protection_transaction_events_no_delete_trg before delete on protection_transaction_events
  for each row execute function protection_transaction_events_guard();

alter table protection_transaction_events enable row level security;
revoke all on protection_transaction_events from anon, authenticated;
grant select, insert, update, delete on protection_transaction_events to service_role;
-- No authenticated policy at all — same posture as protection_ledger_entries: a seller/customer
-- doesn't need the raw event log, only their own transaction's current status (already visible
-- via protection_transactions' existing owner-read policy).

-- ============================================================================
-- 2. TRANSITION-LEGALITY ENFORCEMENT — extends protection_transactions_guard() (defined in
--    2026-11-06_ringo_protection_foundation.sql) to ALSO reject an illegal status transition, on
--    top of the immutable-column checks it already performs. This is defense in depth: the
--    TypeScript engine (src/lib/protection/transitions.ts) is the first line of defense and the
--    only thing wired to anything today; this trigger is the same "database is the final
--    authority, never bypassed" backstop product_orders_guard already provides for Shop orders.
--
--    The transition table below must be kept in sync with LEGAL_TRANSITIONS in
--    src/lib/protection/transitions.ts by hand — the same relationship product_orders_guard's own
--    SQL transition list and productCheckout's application-level checks already have today, not a
--    new kind of drift risk. scripts/tests/protectionTransitions.test.mjs statically cross-checks
--    the two against each other.
-- ============================================================================
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

  if new.status <> old.status and not (
        (old.status = 'awaiting_payment'    and new.status in ('protected', 'payment_failed', 'expired', 'cancelled'))
     or (old.status = 'protected'           and new.status in ('fulfillment_started', 'cancelled', 'disputed'))
     or (old.status = 'fulfillment_started' and new.status in ('awaiting_confirmation', 'disputed', 'cancelled'))
     or (old.status = 'awaiting_confirmation' and new.status in ('released', 'disputed'))
     or (old.status = 'disputed'            and new.status in ('resolved_release', 'resolved_refund'))
     or (old.status = 'resolved_release'    and new.status = 'released')
     or (old.status = 'resolved_refund'     and new.status = 'refunded')) then
    raise exception 'protection_transactions: illegal status transition % -> %', old.status, new.status;
  end if;

  new.updated_at = now();
  return new;
end $$;
-- Trigger itself is unchanged (still BEFORE UPDATE, same function name) — only the function body
-- was replaced, so no drop/recreate of the trigger is needed.

-- Rollback notes (manual, not executed):
--   -- revert protection_transactions_guard() to its Phase 1 body (immutable-column checks only,
--   -- see 2026-11-06_ringo_protection_foundation.sql) via another create-or-replace.
--   drop trigger if exists protection_transaction_events_no_delete_trg on protection_transaction_events;
--   drop trigger if exists protection_transaction_events_no_update_trg on protection_transaction_events;
--   drop function if exists protection_transaction_events_guard();
--   drop table if exists protection_transaction_events;
