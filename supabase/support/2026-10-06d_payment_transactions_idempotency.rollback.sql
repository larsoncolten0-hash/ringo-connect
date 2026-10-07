-- ============================================================================
-- ROLLBACK for supabase/migrations/2026-10-06d_payment_transactions_idempotency.sql
-- Drops ONLY the unique index. No row is touched.
-- ============================================================================
drop index if exists public.payment_transactions_provider_txn_uidx;
