-- Ringo Protection — Phase 6: connects a valid Protection release to the EXISTING
-- commerce_sale_earnings ledger. This is the first Protection migration that touches a table Normal
-- Payment itself writes to — done as narrowly as the schema allows, per the Phase 6 audit's own
-- finding below.
--
-- AUDIT FINDING (Step 1): commerce_sale_earnings.payment_id is `not null` and a real FK to
-- customer_payments(id). Protection has NO customer_payments row at all (Phase 4 deliberately built
-- protection_payments as its own table — see 2026-11-09's own header for why). A Protection-released
-- earning therefore CANNOT be inserted through the existing schema without either (a) fabricating a
-- fake customer_payments row (would corrupt that table's own meaning), or (b) relaxing payment_id to
-- nullable and adding a second, equally-unique origin column for Protection. (b) is the additive,
-- zero-impact choice: every EXISTING row already has a non-null payment_id and is never touched by
-- this migration; only a NEW category of row (a Protection release) is now representable.
--
-- request_commerce_payout() (2026-11-05) and every existing reader (sellerReaders.ts,
-- summariseEarnings()) were checked and read/act on creator_user_id, currency, status, net_amount,
-- available_at and payout_id ONLY — never payment_id. A Protection-sourced row therefore flows
-- through the EXISTING, completely unmodified payout system automatically. No second payout system
-- is created.
--
-- Additive/idempotent throughout, same convention as every migration since 2026-09-12.

begin;

-- ============================================================================
-- 1. commerce_sale_earnings — allow a Protection-release origin alongside the existing
--    Normal-Payment (customer_payments) origin. Postgres treats multiple NULLs in a UNIQUE column as
--    non-conflicting, so payment_id's existing `unique` constraint needs no change at all — only its
--    `not null` is relaxed.
-- ============================================================================
alter table commerce_sale_earnings alter column payment_id drop not null;
alter table commerce_sale_earnings add column if not exists protection_transaction_id uuid
  references protection_transactions(id) on delete restrict;
create unique index if not exists commerce_sale_earnings_protection_transaction_id_idx
  on commerce_sale_earnings (protection_transaction_id) where protection_transaction_id is not null;

-- Every earning row is traceable to EXACTLY one origin — never both, never neither. Existing rows
-- (payment_id not null, protection_transaction_id null) already satisfy this trivially.
alter table commerce_sale_earnings drop constraint if exists commerce_sale_earnings_origin_check;
alter table commerce_sale_earnings add constraint commerce_sale_earnings_origin_check
  check ((payment_id is not null) <> (protection_transaction_id is not null));

-- Widen the existing immutability guard to also freeze protection_transaction_id, and switch the
-- payment_id comparison to IS DISTINCT FROM (NULL-safe) now that it can legitimately be null — for
-- every EXISTING (Normal Payment) row payment_id was, is and always will be non-null, so this change
-- is behaviourally identical for them; it only newly protects the column now that it can be null.
create or replace function commerce_sale_earnings_guard() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.order_id <> old.order_id
     or new.payment_id is distinct from old.payment_id
     or new.protection_transaction_id is distinct from old.protection_transaction_id
     or new.profile_id <> old.profile_id or new.creator_user_id <> old.creator_user_id
     or new.gross_amount <> old.gross_amount or new.commission_rate <> old.commission_rate
     or new.platform_fee <> old.platform_fee or new.net_amount <> old.net_amount
     or new.currency <> old.currency or new.created_at <> old.created_at then
    raise exception 'commerce_sale_earnings: only status may change';
  end if;
  return new;
end $$;
-- (trigger itself already exists and already points at this function; no drop/create needed)

-- ============================================================================
-- 2. protection_transactions — a covering index for the auto-release cron's own eligibility query
--    (status = 'awaiting_confirmation' and auto_release_at <= now()), which Phase 1's own indexes
--    don't cover. Read-only addition; no column, trigger or RLS change.
-- ============================================================================
create index if not exists protection_transactions_auto_release_idx
  on protection_transactions (auto_release_at) where status = 'awaiting_confirmation';

commit;

-- ============================================================================
-- ROLLBACK (documented only; NOT part of the migration. Safe only while no Protection release has
-- happened yet — protection_enabled is still false, so no row anywhere has protection_transaction_id set.)
-- ============================================================================
--   begin;
--   drop index if exists protection_transactions_auto_release_idx;
--   create or replace function commerce_sale_earnings_guard() returns trigger language plpgsql as $$
--   begin
--     if new.id <> old.id or new.order_id <> old.order_id or new.payment_id <> old.payment_id
--        or new.profile_id <> old.profile_id or new.creator_user_id <> old.creator_user_id
--        or new.gross_amount <> old.gross_amount or new.commission_rate <> old.commission_rate
--        or new.platform_fee <> old.platform_fee or new.net_amount <> old.net_amount
--        or new.currency <> old.currency or new.created_at <> old.created_at then
--       raise exception 'commerce_sale_earnings: only status may change';
--     end if;
--     return new;
--   end $$;
--   alter table commerce_sale_earnings drop constraint if exists commerce_sale_earnings_origin_check;
--   drop index if exists commerce_sale_earnings_protection_transaction_id_idx;
--   alter table commerce_sale_earnings drop column if exists protection_transaction_id;
--   alter table commerce_sale_earnings alter column payment_id set not null;
--   commit;
