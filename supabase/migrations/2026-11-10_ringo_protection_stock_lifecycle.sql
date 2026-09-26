-- Ringo Protection — Phase 4 follow-up: close the stock-lifecycle gap the Phase 4 audit flagged.
--
-- ROOT CAUSE: release_product_order_stock() (2026-11-02_product_checkout_foundation.sql) was
-- written before Ringo Protection existed. Its guard clause refuses to release an order's stock
-- while a LIVE (initiated/pending, not yet expired) customer_payments attempt exists for it — but it
-- has no way to know about protection_payments (introduced in 2026-11-09_ringo_protection_checkout.sql,
-- itself not yet applied), because that table did not exist when this function was written. A live
-- Protection payment attempt is therefore invisible to this guard: if create_product_order()'s own
-- internal "reclaim expired orders for this product" loop (or a future direct caller) reached this
-- function for an order with a live Protection payment in flight, it could release that order's stock
-- out from under the payment, even though real money may already be moving through Fapshi for it.
--
-- FIX: widen the SAME function's guard clause with ONE additional, purely conjunctive `and not
-- exists (...)` condition that also checks protection_payments (joined through protection_transactions,
-- since protection_payments has no direct order reference — see its own schema). This is the exact
-- same technique 2026-11-07_ringo_protection_transitions.sql already used to widen
-- protection_transactions_guard() via `create or replace function` in a LATER migration, without
-- touching the original 2026-11-02/2026-11-06 files on disk.
--
-- WHY THIS CANNOT CHANGE NORMAL PAYMENT'S BEHAVIOR: the pre-existing customer_payments exists-clause
-- below is copied byte-for-byte from the original function (see scripts/tests/
-- protectionStockLifecycle.test.mjs's static diff, which enforces this). The new clause is a second,
-- independently-ANDed condition — Normal Payment orders never have a protection_transactions row
-- (Protection is a separate, opt-in checkout path), so the new subquery is always empty for them and
-- can only ever be a universally-true no-op there. For a Normal Payment order, this function's
-- observable behavior is provably identical to before.
--
-- Depends on protection_transactions (2026-11-06, not yet applied) and protection_payments
-- (2026-11-09, not yet applied) already existing — must be applied AFTER both, in migration order.
-- Not applied by this session. Additive: no table, column or existing migration file is modified.

create or replace function release_product_order_stock(p_order_id uuid, p_new_status text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_claimed uuid;
begin
  if p_new_status not in ('expired','cancelled') then
    raise exception 'release_product_order_stock: invalid status %', p_new_status;
  end if;
  update product_orders set status = p_new_status, stock_released_at = now()
   where id = p_order_id and status = 'awaiting_payment' and stock_released_at is null
     and (p_new_status <> 'expired' or expires_at <= now())
     and not exists (select 1 from customer_payments cp
                      where cp.target_type = 'product_order' and cp.target_id = p_order_id
                        and cp.status in ('initiated','pending') and cp.expires_at > now())
     -- NEW: the same "don't release while a live payment attempt exists" rule, extended to Ringo
     -- Protection's own payment table. protection_payments has no order id of its own — it is
     -- reached through its parent protection_transactions row (unique per order, target_type/
     -- target_id = 'product_order'/this order).
     and not exists (select 1 from protection_payments pp
                      join protection_transactions pt on pt.id = pp.protection_transaction_id
                      where pt.target_type = 'product_order' and pt.target_id = p_order_id
                        and pp.status in ('initiated','pending') and pp.expires_at > now())
  returning id into v_claimed;
  if v_claimed is null then return false; end if;
  update products p set inventory_count = p.inventory_count + s.qty
    from (select product_id, sum(quantity)::int as qty from product_order_items
           where order_id = p_order_id and product_id is not null group by product_id) s
   where p.id = s.product_id and p.inventory_count is not null;
  return true;
end $$;

-- Rollback notes (manual, not executed): re-run the ORIGINAL function body from
-- 2026-11-02_product_checkout_foundation.sql via `create or replace function` (it is still on disk,
-- unmodified) to revert to the pre-Protection guard.
