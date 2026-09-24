// Reconciliation sweep: finds payments that may have succeeded while nobody was watching (the customer
// closed the tab) and settles them. It contains NO settlement logic of its own — every order goes
// through checkProductPayment(), i.e. the same provider check, amount verification, idempotent
// settlement, payment_review routing and lazy expiry the customer's own polling uses. Running it twice,
// or concurrently with a customer's poll, cannot create a second earning or settle an order twice.

import { LATE_CONFIRMATION_LOOKBACK_HOURS, RECONCILE_CONCURRENCY, RECONCILE_MAX_ORDERS_PER_RUN, RECONCILE_TIME_BUDGET_MS } from "./constants";
import { checkProductPayment } from "./checkPayment";
import type { CheckoutDeps } from "./types";

export interface ReconcileSummary {
  examined: number;
  succeeded: number;
  pending: number;
  failed: number;
  expired: number;
  review: number;
  not_started: number;
  errors: number;
  /** true when the time budget ran out before every candidate was examined */
  budget_exhausted: boolean;
}

export async function reconcileProductPayments(
  deps: CheckoutDeps,
  opts: { maxOrders?: number; concurrency?: number; timeBudgetMs?: number; clockMs?: () => number } = {}
): Promise<ReconcileSummary> {
  const maxOrders = Math.max(1, Math.min(opts.maxOrders ?? RECONCILE_MAX_ORDERS_PER_RUN, 100));
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? RECONCILE_CONCURRENCY, 10));
  const budget = opts.timeBudgetMs ?? RECONCILE_TIME_BUDGET_MS;
  const clock = opts.clockMs ?? Date.now;
  const started = clock();

  const summary: ReconcileSummary = { examined: 0, succeeded: 0, pending: 0, failed: 0, expired: 0, review: 0, not_started: 0, errors: 0, budget_exhausted: false };
  const since = new Date(deps.now().getTime() - LATE_CONFIRMATION_LOOKBACK_HOURS * 3_600_000).toISOString();
  const ids = [...new Set(await deps.store.listReconcilableOrderIds({ sinceIso: since, limit: maxOrders }))].slice(0, maxOrders);

  for (let i = 0; i < ids.length; i += concurrency) {
    if (clock() - started >= budget) {
      summary.budget_exhausted = true;
      break;
    }
    await Promise.all(
      ids.slice(i, i + concurrency).map(async (orderId) => {
        try {
          const r = await checkProductPayment(deps, orderId);
          summary.examined++;
          if (!r.ok) summary.errors++;
          else summary[r.data.status]++;
        } catch (err) {
          summary.examined++;
          summary.errors++;
          deps.log("product_reconcile_error", { orderId, error: String((err as Error)?.message || err).slice(0, 160) });
        }
      })
    );
  }
  return summary;
}
