// Seller fulfillment: paid -> fulfilled, and nothing else (Increment 5A). Pure and dependency-free.
// Ownership is established by the caller's RLS-scoped read (FulfillStore.getOwnedOrder); the write is a
// conditional claim (only while the order is still `paid`) so a double click, two tabs or a retry can
// never produce a bad state - the losing call simply finds the order already fulfilled. The database
// trigger (product_orders_guard) stays the final authority and is never bypassed.

import { canFulfil } from "./sellerOrders";
import { sellerFail, sellerOk, type SellerResult } from "./sellerErrors";
import type { OrderStatus } from "./types";
import { isUuid } from "./validation";

export interface FulfillStore {
  /** The order if - and only if - the signed-in seller owns it (read under RLS). */
  getOwnedOrder(orderId: string): Promise<{ id: string; status: OrderStatus } | null>;
  /** Conditional update `... where id = ? and status = 'paid'`. true = this call changed the row. */
  claimFulfilled(orderId: string): Promise<boolean>;
  log?(event: string, data?: Record<string, unknown>): void;
}

export interface FulfillOutcome {
  status: "fulfilled";
  /** true when the order was already fulfilled (a repeat or a lost race): nothing changed */
  already: boolean;
}

export interface FulfillHooks {
  /** Best effort, called exactly once — only by the caller that actually flips paid -> fulfilled
   *  (never on a repeat request or a lost race). Never blocks or reverses the claim; a hook that
   *  throws is swallowed and logged the same way settlement.ts's own onOrderPaid hook is. Exists so
   *  a later phase (Ringo Protection) can react to a real fulfillment without this file knowing
   *  anything about Protection — mirrors CheckoutDeps.onOrderPaid exactly. */
  onFulfilled?: (orderId: string) => Promise<void>;
}

export async function fulfillOrder(store: FulfillStore, orderId: string, hooks: FulfillHooks = {}): Promise<SellerResult<FulfillOutcome>> {
  if (!isUuid(orderId)) return sellerFail("order_not_found");
  const order = await store.getOwnedOrder(orderId);
  if (!order) return sellerFail("order_not_found"); // missing and "someone else's" look identical
  if (order.status === "fulfilled") return sellerOk({ status: "fulfilled", already: true });
  if (!canFulfil(order.status)) return sellerFail("order_not_fulfillable");

  let changed: boolean;
  try {
    changed = await store.claimFulfilled(order.id);
  } catch (err) {
    // A database-trigger refusal (an illegal transition) is a conflict, not a crash; anything else bubbles up.
    const msg = String((err as Error)?.message || err);
    if (/illegal status transition|immutable/i.test(msg)) {
      store.log?.("product_fulfill_refused_by_guard", { orderId: order.id });
      return sellerFail("order_not_fulfillable");
    }
    throw err;
  }
  if (changed) {
    if (hooks.onFulfilled) {
      try {
        await hooks.onFulfilled(order.id);
      } catch (err) {
        store.log?.("product_fulfill_hook_failed", { orderId: order.id, error: String((err as Error)?.message || err).slice(0, 120) });
      }
    }
    return sellerOk({ status: "fulfilled", already: false });
  }

  // Nothing changed: either someone else fulfilled it a moment ago, or its status moved on.
  const now = await store.getOwnedOrder(order.id);
  if (now?.status === "fulfilled") return sellerOk({ status: "fulfilled", already: true });
  return sellerFail("order_not_fulfillable");
}
