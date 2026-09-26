// Ringo Protection — Phase 5: connects a Protection transaction to the EXISTING Shop fulfillment
// action (paid -> fulfilled). Pure and dependency-free, same discipline as engine.ts/checkoutTypes.ts:
// no Supabase, no Next. Every status change goes through the unmodified Phase 2 engine
// (transitionProtectionTransaction, injected as deps.transition) — nothing here writes
// protection_transactions.status directly.
//
// Shop V1 has exactly ONE seller-facing fulfillment action (fulfillOrder(): paid -> fulfilled,
// nothing in between — see the Phase 5 audit). There is no separate "seller started fulfillment" vs
// "seller completed fulfillment" moment to hook two different Shop events onto. This function
// therefore advances the Protection transaction through BOTH of its own next steps
// (protected -> fulfillment_started -> awaiting_confirmation) as the direct, honest consequence of
// that ONE real action — never a customer action, never a cron, never "system": both transitions are
// requested by the SAME seller actor, exactly matching the Phase 2 transition map's own
// authorization rule (`fulfillment_started -> awaiting_confirmation` only accepts a `seller` actor).
// If a future Shop feature ever introduces a genuine multi-stage fulfillment pipeline, a later phase
// can split these two calls across two separate Shop events without touching this file's contract.
//
// Exactly-once by construction: this is only ever invoked from fulfillOrder()'s own `onFulfilled`
// hook, which itself only fires for the ONE caller that actually flips paid -> fulfilled (never on a
// repeat request, never for a losing concurrent request) — so this function does not need its own
// idempotency guard for "was I called twice for the same order," only for what it does once called
// (which is itself idempotent: transitionProtectionTransaction already treats a re-request that finds
// the transaction already at the target status as a successful no-op).

import type { ProtectionActor, ProtectionStatus } from "./types";

export interface ProtectionFulfillmentTransactionRow {
  id: string;
  status: ProtectionStatus;
}

export interface ProtectionFulfillmentStore {
  /** Looks up the (at most one) protection_transactions row for this order, or null if this is a
   *  Normal Payment order — the single point that makes every function below a guaranteed no-op
   *  for a Normal Payment order. */
  getProtectionTransactionByOrder(orderId: string): Promise<ProtectionFulfillmentTransactionRow | null>;
}

export type FulfillmentTransitionResult =
  | { ok: true; status: ProtectionStatus; alreadyInStatus: boolean }
  | { ok: false; code: string; status: ProtectionStatus | null };

export interface ProtectionFulfillmentDeps {
  store: ProtectionFulfillmentStore;
  /** Runs the ALREADY-BUILT, unmodified Phase 2 engine transition. */
  transition: (id: string, to: ProtectionStatus, actor: ProtectionActor) => Promise<FulfillmentTransitionResult>;
  /** Best-effort, fired only for the transition that actually happened (never on a no-op re-request). */
  onFulfillmentStarted?: (info: { orderId: string; protectionTransactionId: string }) => Promise<void>;
  onAwaitingConfirmation?: (info: { orderId: string; protectionTransactionId: string }) => Promise<void>;
  log: (event: string, data?: Record<string, unknown>) => void;
}

/**
 * Called from fulfillOrder()'s onFulfilled hook, once, by the caller that just flipped the order to
 * `fulfilled`. A guaranteed no-op for a Normal Payment order (no protection_transactions row) and
 * for a Protection transaction that isn't currently `protected` (already advanced, disputed,
 * cancelled, expired, payment_failed, released, refunded — none of those are ever force-advanced by
 * this function; that would bypass the dispute/cancellation/release workflows those states belong to).
 */
export async function advanceProtectionOnSellerFulfillment(
  deps: ProtectionFulfillmentDeps,
  orderId: string,
  actor: { type: "seller"; userId: string }
): Promise<void> {
  const txn = await deps.store.getProtectionTransactionByOrder(orderId);
  if (!txn) return; // Normal Payment order — nothing to do

  // Resumable from EITHER of its two valid entry points: `protected` (the normal, fresh case) or
  // `fulfillment_started` (a retried/resumed call after a crash between the two transitions below —
  // this function is only ever invoked once per order today, but staying resumable from both points
  // costs nothing and avoids a transaction ever getting permanently stuck between them). Any other
  // status (already awaiting_confirmation or beyond, disputed, cancelled, expired, payment_failed) is
  // a guaranteed no-op — never force-advanced, never bypassing the workflow that status belongs to.
  if (txn.status !== "protected" && txn.status !== "fulfillment_started") {
    deps.log("protection_fulfillment_skip_not_eligible", { orderId, transactionId: txn.id, status: txn.status });
    return;
  }

  if (txn.status === "protected") {
    const started = await deps.transition(txn.id, "fulfillment_started", actor);
    if (!started.ok) {
      deps.log("protection_fulfillment_started_failed", { orderId, transactionId: txn.id, code: started.code });
      return;
    }
    if (!started.alreadyInStatus && deps.onFulfillmentStarted) {
      try {
        await deps.onFulfillmentStarted({ orderId, protectionTransactionId: txn.id });
      } catch (err) {
        deps.log("protection_fulfillment_started_notify_failed", { orderId, error: String((err as Error)?.message || err).slice(0, 120) });
      }
    }
  }

  const awaiting = await deps.transition(txn.id, "awaiting_confirmation", actor);
  if (!awaiting.ok) {
    deps.log("protection_awaiting_confirmation_failed", { orderId, transactionId: txn.id, code: awaiting.code });
    return;
  }
  if (!awaiting.alreadyInStatus && deps.onAwaitingConfirmation) {
    try {
      await deps.onAwaitingConfirmation({ orderId, protectionTransactionId: txn.id });
    } catch (err) {
      deps.log("protection_awaiting_confirmation_notify_failed", { orderId, error: String((err as Error)?.message || err).slice(0, 120) });
    }
  }
}
