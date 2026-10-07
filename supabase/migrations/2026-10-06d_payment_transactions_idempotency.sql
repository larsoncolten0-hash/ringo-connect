-- ============================================================================
-- Ringo Connect - security / financial integrity: one payment_transactions row per provider transaction
--
-- REQUIRES OWNER APPROVAL AND MANUAL APPLICATION. Adds ONE unique index. No row, column, policy or function is changed.
-- Roll back with supabase/support/2026-10-06d_payment_transactions_idempotency.rollback.sql.
--
-- THE PROBLEM
--   payment_transactions is not created by any migration in this repository (it was created outside them), so a uniqueness
--   rule on (provider, provider_transaction_id) cannot be assumed. The Stripe webhook inserts one row per
--   checkout.session.completed event and Stripe DOES redeliver events (retries, replays). Without the index, a duplicate
--   delivery adds a second 'success' row, and the AFTER INSERT commission trigger
--   (handle_payment_transaction_commission, unique only on payment_transaction_id) then credits a second affiliate
--   commission and the admin gets a second "New paid member" notification. The application now de-duplicates before
--   inserting (src/lib/stripeIdempotency.ts); this index makes the rule hold under concurrent deliveries as well.
--
-- WHAT THE INDEX COVERS
--   Partial: rows whose provider_transaction_id is NOT NULL (a signup approval can legitimately record a transaction with no
--   provider id). Every writer in the code uses an id that is unique per transaction: Fapshi transId, Stripe session id,
--   and "manual-<signup request id>".
--
-- SAFE TO RUN: the block does nothing (and says so) if the table or columns are not there, or if the index already exists. If
-- DUPLICATES ALREADY EXIST it STOPS with an error that lists how many groups - it never deletes or edits a row. Resolve them
-- by hand (keep the earliest, investigate the rest - especially any duplicated commission) and run this again.
-- ============================================================================
do $$
declare
  v_dups bigint;
begin
  if to_regclass('public.payment_transactions') is null then
    raise notice 'payment_transactions not found in this database: nothing to do';
    return;
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'payment_transactions' and column_name in ('provider', 'provider_transaction_id')) < 2 then
    raise notice 'payment_transactions has no provider / provider_transaction_id columns: nothing to do';
    return;
  end if;
  if exists (
    select 1 from pg_index i
      join pg_class c on c.oid = i.indrelid
     where c.oid = 'public.payment_transactions'::regclass and i.indisunique and i.indnatts = 2
       and (select array_agg(a.attname::text order by a.attname::text) from pg_attribute a where a.attrelid = c.oid and a.attnum = any (i.indkey))
           = array['provider', 'provider_transaction_id']
  ) then
    raise notice 'a unique index on (provider, provider_transaction_id) already exists: nothing to do';
    return;
  end if;

  select count(*) into v_dups from (
    select 1 from public.payment_transactions
     where provider_transaction_id is not null
     group by provider, provider_transaction_id having count(*) > 1
  ) d;
  if v_dups > 0 then
    raise exception 'cannot create the unique index: % (provider, provider_transaction_id) group(s) already have more than one row. Review them first (select provider, provider_transaction_id, count(*) from payment_transactions where provider_transaction_id is not null group by 1, 2 having count(*) > 1). Nothing was changed.', v_dups;
  end if;

  create unique index if not exists payment_transactions_provider_txn_uidx
    on public.payment_transactions (provider, provider_transaction_id)
    where provider_transaction_id is not null;
end $$;
