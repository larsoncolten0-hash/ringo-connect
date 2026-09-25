-- Ringo Protection — Phase 3: refund mechanism data model ONLY. Still dormant — nothing in this
-- migration is reachable from checkout, Fapshi, or any customer/seller-facing surface, and no
-- route calls the Phase 3 domain module (src/lib/protection/refund*.ts) at all yet.
--
-- Audit findings this schema is built around (see the Phase 3 session's own report for detail):
--   * Fapshi's audited API surface (src/lib/fapshi.ts) has NO dedicated refund/reversal endpoint —
--     only a generic outbound `payout`, already used for seller/artist/affiliate disbursement.
--     A Protection refund can therefore only ever be a fapshiPayout() call, explicitly RECORDED
--     as a refund in Ringo's own system (this table) while the underlying Fapshi operation is
--     mechanically identical to any other payout — never silently indistinguishable from one.
--   * customer_payments has NO phone column at all (confirmed against its own foundation
--     migration) — the paying Mobile Money number is used once, transiently, inside
--     initiateProductPayment() and never persisted anywhere. destination_phone/destination_network
--     below are therefore nullable BY DESIGN: this schema does not assume a number is available,
--     and nothing populates one automatically from any existing column.
--
-- Additive/idempotent throughout, same convention as every migration since 2026-09-12.

-- ============================================================================
-- PROTECTION REFUNDS — one row per protected transaction's refund (at most one, ever: see the
-- unique index on protection_transaction_id below). A separate, dedicated financial record, not a
-- repurposing of protection_ledger_entries (still financial-event-only per Phase 1's own contract,
-- and Phase 3 does not write to it either — see the module's own header for why) or
-- protection_transaction_events (Phase 2's non-financial lifecycle log).
-- ============================================================================
create table if not exists protection_refunds (
  id uuid primary key default gen_random_uuid(),
  protection_transaction_id uuid not null unique references protection_transactions(id) on delete restrict,
  -- Denormalized snapshot of the transaction's own target_id at refund-creation time — convenient
  -- for audit/reporting without a join, immutable like every other snapshot field here.
  order_id uuid not null,
  customer_id uuid references ringo_customers(id) on delete set null,

  refund_amount numeric(12,2) not null check (refund_amount > 0),
  currency text not null check (currency = upper(currency) and char_length(currency) = 3),

  -- Nullable by design — see the migration header. Supplied/verified at the point a refund is
  -- actually processed, never invented, never an admin's or a Ringo team member's own number.
  destination_phone text,
  destination_network text check (destination_network is null or destination_network in ('mtn', 'orange')),

  reason text check (reason is null or char_length(reason) <= 1000),

  status text not null default 'requested' check (status in ('requested', 'processing', 'completed', 'failed')),
  -- The same protection_transaction can only ever have ONE refund attempt row (see the unique
  -- constraint on protection_transaction_id above) — a failed attempt is retried by re-processing
  -- THIS row, never by inserting a second one. idempotency_key is the finer-grained guard for a
  -- single retried REQUEST (e.g. a duplicated HTTP call) resolving to the same operation.
  idempotency_key text unique,

  provider text not null default 'fapshi' check (provider in ('fapshi')),
  provider_reference text,
  provider_status text,

  requested_at timestamptz not null default now(),
  processing_started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (status <> 'completed' or completed_at is not null),
  check (status <> 'failed' or failed_at is not null)
);
create index if not exists protection_refunds_status_idx on protection_refunds (status, requested_at);
create index if not exists protection_refunds_customer_idx on protection_refunds (customer_id);

-- ============================================================================
-- GUARD — immutable identity/amount columns once set (mirrors every other guard in this schema),
-- legal status transitions ONLY (requested->processing->{completed,failed}; completed and failed
-- are both terminal — "completed -> processing" and any other backward/lateral move is rejected
-- at the database layer, not just by application code), and money safety: refund_amount can never
-- exceed the parent protection_transaction's own snapshotted seller_protected_amount.
-- ============================================================================
create or replace function protection_refunds_guard() returns trigger language plpgsql as $$
declare
  v_protected_amount numeric(12,2);
begin
  if new.id <> old.id or new.protection_transaction_id <> old.protection_transaction_id
     or new.order_id <> old.order_id or new.customer_id is distinct from old.customer_id
     or new.refund_amount <> old.refund_amount or new.currency <> old.currency
     or new.created_at <> old.created_at then
    raise exception 'protection_refunds: immutable column changed';
  end if;

  if new.status <> old.status and not (
        (old.status = 'requested'  and new.status = 'processing')
     or (old.status = 'processing' and new.status in ('completed', 'failed'))
     -- A failed attempt is eligible to retry from the SAME row: processing is re-entered, never
     -- skipped straight back to completed.
     or (old.status = 'failed'     and new.status = 'processing')) then
    raise exception 'protection_refunds: illegal status transition % -> %', old.status, new.status;
  end if;

  new.updated_at = now();
  return new;
end $$;
drop trigger if exists protection_refunds_guard_trg on protection_refunds;
create trigger protection_refunds_guard_trg before update on protection_refunds
  for each row execute function protection_refunds_guard();

-- Money safety, enforced on INSERT: a refund can never be created for more than the transaction's
-- own protected amount, and never for a transaction that is already released or already refunded
-- (a transaction moving to `refunded` is itself gated by protection_transactions_guard only
-- accepting resolved_refund -> refunded, so this is defense in depth, not the only guard).
create or replace function protection_refunds_amount_guard() returns trigger language plpgsql as $$
declare
  v_protected_amount numeric(12,2);
  v_txn_status text;
begin
  select seller_protected_amount, status into v_protected_amount, v_txn_status
  from protection_transactions where id = new.protection_transaction_id;

  if v_protected_amount is null then
    raise exception 'protection_refunds: protection_transaction_id does not exist';
  end if;
  if new.refund_amount > v_protected_amount then
    raise exception 'protection_refunds: refund_amount (%) exceeds the protected amount (%)', new.refund_amount, v_protected_amount;
  end if;
  if v_txn_status in ('released', 'refunded') then
    raise exception 'protection_refunds: cannot create a refund for a transaction already % ', v_txn_status;
  end if;

  return new;
end $$;
drop trigger if exists protection_refunds_amount_guard_trg on protection_refunds;
create trigger protection_refunds_amount_guard_trg before insert on protection_refunds
  for each row execute function protection_refunds_amount_guard();

-- ============================================================================
-- ROW LEVEL SECURITY — restrictive by design, more so than protection_transactions itself. Per
-- the explicit requirement: customers cannot modify refund status, sellers cannot mark their own
-- refund completed, and admin access is READ/audit-oriented only — completing/failing a refund is
-- a trusted-server-code operation (the service-role client, from a future admin-authorized route),
-- never a direct RLS-granted UPDATE for the `authenticated` role, admin included.
-- ============================================================================
alter table protection_refunds enable row level security;
revoke all on protection_refunds from anon, authenticated;
grant select, insert, update, delete on protection_refunds to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'protection_refunds' and policyname = 'protection_refunds admin read') then
    create policy "protection_refunds admin read" on protection_refunds for select to authenticated using (is_admin());
  end if;
end $$;
-- No seller or customer policy at all: a seller has no legitimate need to see refund internals
-- (provider references, destination numbers), and a customer's own refund state is something a
-- future phase would surface through a purpose-built, field-limited read path, not raw RLS access
-- to this table.

-- Rollback notes (manual, not executed):
--   drop trigger if exists protection_refunds_amount_guard_trg on protection_refunds;
--   drop function if exists protection_refunds_amount_guard();
--   drop trigger if exists protection_refunds_guard_trg on protection_refunds;
--   drop function if exists protection_refunds_guard();
--   drop table if exists protection_refunds;
