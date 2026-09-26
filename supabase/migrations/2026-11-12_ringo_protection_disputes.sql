-- Ringo Protection — Phase 7: dispute record + admin resolution (release/refund-request) support.
--
-- AUDIT FINDINGS this migration is built around:
--   * The unmodified Phase 2 transition map (transitions.ts) ALREADY allows `disputed` to be entered
--     from THREE states — `protected`, `fulfillment_started`, `awaiting_confirmation` (customer actor
--     only) — and already allows an admin to resolve `disputed` into either `resolved_release` or
--     `resolved_refund`, and `resolved_release`/`resolved_refund` into `released`/`refunded`
--     respectively. Phase 7 does not invent any new transition — every one of these already exists,
--     untouched, in the already-applied 2026-11-07 migration.
--   * Phase 1's own migration comment anticipated a dispute table and speculated about a
--     `protection_transactions.dispute_id` column. Phase 7 deliberately does NOT add one — exactly
--     like protection_refunds (Phase 3) needed no `protection_transactions.refund_id` column, a
--     dispute is looked up the other way (`protection_disputes.protection_transaction_id`, unique),
--     keeping the pattern consistent and protection_transactions itself untouched again.
--   * A NEW race Phase 7 introduces that Phase 6 (release.ts) did not anticipate: before disputes
--     existed, `awaiting_confirmation` could only ever be left via release, so a stale read inside
--     release.ts before its own earnings insert was harmless. Now a transaction can ALSO leave
--     `awaiting_confirmation` via a customer dispute. If release.ts's earnings insert (based on a
--     read taken before the dispute committed) is not itself re-validated against the LIVE row, a
--     disputed transaction could end up with a release earning it should never have. This migration
--     closes that gap at the database layer (the same defense-in-depth technique
--     protection_refunds_amount_guard already uses) rather than relying on release.ts's own
--     application-level read alone — see commerce_sale_earnings_protection_status_guard() below.
--
-- Additive/idempotent throughout, same convention as every migration since 2026-09-12.

begin;

-- ============================================================================
-- 1. PROTECTION DISPUTES — one row per Protection transaction that is ever disputed (at most one,
--    ever: see the unique constraint). Mirrors protection_refunds' own shape/discipline closely:
--    identity/reason columns frozen after insert, only `status`/`resolved_by`/`resolved_at` may
--    change, and only along the legal `open -> resolved_release | resolved_refund` path (which the
--    unmodified Phase 2 engine ALSO independently enforces on protection_transactions.status itself
--    — this is defense in depth on the dispute record, not the only guard).
-- ============================================================================
create table if not exists protection_disputes (
  id uuid primary key default gen_random_uuid(),
  protection_transaction_id uuid not null unique references protection_transactions(id) on delete restrict,

  -- Denormalized snapshot for convenient querying without a join — same reasoning protection_refunds'
  -- own order_id column already documents. protection_transactions remains the sole source of truth
  -- for protected amount/currency/payment state; nothing here can override it (see check below).
  order_id uuid not null,
  customer_id uuid references ringo_customers(id) on delete set null,
  profile_id uuid not null references profiles(id) on delete restrict,

  reason text not null check (char_length(btrim(reason)) between 1 and 100),
  message text check (message is null or char_length(message) <= 2000),

  status text not null default 'open' check (status in ('open', 'resolved_release', 'resolved_refund')),
  resolved_by uuid references public.users(id),
  resolved_at timestamptz,

  opened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (status = 'open' or (resolved_by is not null and resolved_at is not null))
);
create index if not exists protection_disputes_status_idx on protection_disputes (status, opened_at);
create index if not exists protection_disputes_profile_idx on protection_disputes (profile_id, status);

-- Immutable identity/reason columns; only the legal open -> resolved_* transition may change status.
create or replace function protection_disputes_guard() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.protection_transaction_id <> old.protection_transaction_id
     or new.order_id <> old.order_id or new.customer_id is distinct from old.customer_id
     or new.profile_id <> old.profile_id or new.reason <> old.reason
     or new.message is distinct from old.message
     or new.opened_at <> old.opened_at or new.created_at <> old.created_at then
    raise exception 'protection_disputes: immutable column changed';
  end if;
  if new.status <> old.status and not (old.status = 'open' and new.status in ('resolved_release', 'resolved_refund')) then
    raise exception 'protection_disputes: illegal status transition % -> %', old.status, new.status;
  end if;
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists protection_disputes_guard_trg on protection_disputes;
create trigger protection_disputes_guard_trg before update on protection_disputes
  for each row execute function protection_disputes_guard();

-- Money-safety-equivalent guard for disputes: a dispute can only ever be OPENED while the parent
-- transaction is genuinely still in a disputable state, checked against the LIVE row at insert time
-- (not the application's possibly-stale read) — same technique protection_refunds_amount_guard uses.
create or replace function protection_disputes_eligibility_guard() returns trigger language plpgsql as $$
declare
  v_status text;
begin
  -- FOR UPDATE: locks the parent row for the duration of this transaction, so a concurrent writer
  -- of protection_transactions.status (e.g. the auto-release job's own UPDATE) is serialized against
  -- this check rather than racing it — the same technique request_commerce_payout() already uses.
  select status into v_status from protection_transactions where id = new.protection_transaction_id for update;
  if v_status is null then
    raise exception 'protection_disputes: protection_transaction_id does not exist';
  end if;
  if v_status not in ('protected', 'fulfillment_started', 'awaiting_confirmation') then
    raise exception 'protection_disputes: cannot open a dispute while transaction is %', v_status;
  end if;
  return new;
end $$;
drop trigger if exists protection_disputes_eligibility_guard_trg on protection_disputes;
create trigger protection_disputes_eligibility_guard_trg before insert on protection_disputes
  for each row execute function protection_disputes_eligibility_guard();

-- ============================================================================
-- ROW LEVEL SECURITY — same posture as protection_transactions/protection_refunds: seller (profile
-- owner) or admin may READ; service-role only for every write (dispute creation and resolution both
-- go through trusted server routes, never a direct client-side RLS-granted write). No customer
-- policy: Ringo customer identity is a separate cookie-based session (ringo_customers), never a
-- Supabase Auth user with an auth.uid() — exactly why customer_payments/protection_payments also
-- have no customer RLS policy; a customer's own dispute status is surfaced only through the
-- service-role-backed receipt/API routes.
-- ============================================================================
alter table protection_disputes enable row level security;
revoke all on protection_disputes from anon, authenticated;
grant select, insert, update, delete on protection_disputes to service_role;
grant select on protection_disputes to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'protection_disputes' and policyname = 'protection_disputes owner read') then
    create policy "protection_disputes owner read" on protection_disputes for select to authenticated using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin())));
  end if;
end $$;

-- ============================================================================
-- 2. commerce_sale_earnings — re-validate the PARENT transaction's live status at the moment a
--    Protection-origin earning is actually inserted, closing the race the header comment describes.
--    A Normal Payment row (protection_transaction_id is null) is completely unaffected.
-- ============================================================================
create or replace function commerce_sale_earnings_protection_status_guard() returns trigger language plpgsql as $$
declare
  v_status text;
begin
  if new.protection_transaction_id is not null then
    -- FOR UPDATE: same reasoning as protection_disputes_eligibility_guard() above — serializes this
    -- check against a concurrent status-changing transaction (a customer's dispute, an admin
    -- resolution, another release attempt) instead of racing a possibly-stale read of it.
    select status into v_status from protection_transactions where id = new.protection_transaction_id for update;
    if v_status is null then
      raise exception 'commerce_sale_earnings: protection_transaction_id does not exist';
    end if;
    if v_status not in ('awaiting_confirmation', 'resolved_release') then
      raise exception 'commerce_sale_earnings: cannot create a Protection earning while transaction is %', v_status;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists commerce_sale_earnings_protection_status_guard_trg on commerce_sale_earnings;
create trigger commerce_sale_earnings_protection_status_guard_trg before insert on commerce_sale_earnings
  for each row execute function commerce_sale_earnings_protection_status_guard();

-- ============================================================================
-- 3. PLATFORM SETTINGS — explicit, fail-closed capability gate for REAL provider refund money
--    movement. Defaults false; nothing in this migration or Phase 7's application code ever sets it
--    to true. No admin UI control is added for it in this phase (see the Phase 7 report) — changing
--    it requires a direct, deliberate database action, never an accidental toggle.
-- ============================================================================
alter table platform_settings add column if not exists protection_refund_provider_enabled boolean not null default false;

commit;

-- ============================================================================
-- ROLLBACK (documented only; NOT part of the migration. Safe only while no dispute has ever been
-- opened — protection_enabled is still false, so protection_disputes is guaranteed empty.)
-- ============================================================================
--   begin;
--   alter table platform_settings drop column if exists protection_refund_provider_enabled;
--   drop trigger if exists commerce_sale_earnings_protection_status_guard_trg on commerce_sale_earnings;
--   drop function if exists commerce_sale_earnings_protection_status_guard();
--   drop trigger if exists protection_disputes_eligibility_guard_trg on protection_disputes;
--   drop function if exists protection_disputes_eligibility_guard();
--   drop trigger if exists protection_disputes_guard_trg on protection_disputes;
--   drop function if exists protection_disputes_guard();
--   drop table if exists protection_disputes;
--   commit;
