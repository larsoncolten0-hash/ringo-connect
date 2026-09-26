// Ringo Protection — Phase 6: the ONE place a Protection transaction is ever released and the ONE
// place a Protection-origin commerce_sale_earnings row is ever created. Pure and dependency-free,
// same discipline as engine.ts/fulfillment.ts. Every status change goes through the unmodified
// Phase 2 engine (transitionProtectionTransaction, injected as deps.transition) — this file never
// writes protection_transactions.status directly.
//
// DESIGN NOTE — why the earning is created BEFORE the transition (not after): if earning creation
// fails, the transaction must stay exactly where it was (awaiting_confirmation), safely retryable —
// never `released` with no corresponding money owed to the seller (Case A in the Phase 6 spec).
// Doing it in this order makes that the ONLY reachable outcome: either both succeed, or neither does.
//
// IMPORTANT — no commission on a Protection release: protection_transactions never snapshots a
// commerce commission rate (only its own protection_fee_rate), and seller_protected_amount is
// defined, by its own Phase 1 CHECK constraint, to equal product_amount exactly. The seller's net
// earnings from a Protection release are therefore the FULL protected amount, with platform revenue
// coming entirely from the separately-charged, already-collected protection_fee_amount — never a
// second deduction from the seller. commission_rate/platform_fee are recorded as 0 on the earning row
// (satisfies commerce_sale_earnings' own `gross_amount = platform_fee + net_amount` CHECK trivially).

import type { ProtectionActor, ProtectionStatus } from "./types";

export interface ProtectionReleaseTransactionRow {
  id: string;
  target_id: string; // product_orders.id
  status: ProtectionStatus;
  profile_id: string;
  creator_user_id: string;
  customer_id: string | null;
  currency: string;
  seller_protected_amount: number | string;
}

export type ProtectionReleaseActor = { type: "customer"; customerId: string } | { type: "system" };

export type ReleaseFailureCode = "not_found" | "unauthorized" | "not_eligible" | "earnings_failed" | "conflict";

export type ReleaseOutcome =
  | { ok: true; status: "released"; alreadyReleased: boolean }
  | { ok: false; code: ReleaseFailureCode };

export interface ProtectionReleaseStore {
  getProtectionTransaction(id: string): Promise<ProtectionReleaseTransactionRow | null>;
  /** `null` if no earning has been recorded for this transaction yet. */
  getEarningByProtectionTransaction(id: string): Promise<{ id: string } | null>;
  /** 'exists' on the (protection_transaction_id) unique violation — the caller re-reads to confirm. */
  insertProtectionEarning(row: {
    orderId: string;
    protectionTransactionId: string;
    profileId: string;
    creatorUserId: string;
    grossAmount: number;
    currency: string;
  }): Promise<{ ok: true } | { ok: false; reason: "exists" }>;
  /** Best-effort append-only ledger entry (protection_ledger_entries, event_type='release'). Never throws. */
  recordReleaseLedgerEntry(input: { protectionTransactionId: string; amount: number; currency: string; idempotencyKey: string }): Promise<void>;
  /** Bounded batch of transaction ids past their auto_release_at deadline, still awaiting_confirmation. */
  listAutoReleaseEligibleTransactionIds(args: { nowIso: string; limit: number }): Promise<string[]>;
}

export type ReleaseTransitionResult =
  | { ok: true; status: ProtectionStatus; alreadyInStatus: boolean }
  | { ok: false; code: string; status: ProtectionStatus | null };

export interface ProtectionReleaseDeps {
  store: ProtectionReleaseStore;
  /** Runs the ALREADY-BUILT, unmodified Phase 2 engine transition. */
  transition: (id: string, to: ProtectionStatus, actor: ProtectionActor) => Promise<ReleaseTransitionResult>;
  /** Best-effort, fired only for the caller that actually released it (never on a no-op re-request). */
  onReleased?: (info: { orderId: string; protectionTransactionId: string }) => Promise<void>;
  log: (event: string, data?: Record<string, unknown>) => void;
}

async function ensureProtectionEarning(store: ProtectionReleaseStore, txn: ProtectionReleaseTransactionRow): Promise<{ ok: boolean }> {
  const existing = await store.getEarningByProtectionTransaction(txn.id);
  if (existing) return { ok: true };

  const amount = Number(txn.seller_protected_amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false };

  const inserted = await store.insertProtectionEarning({
    orderId: txn.target_id,
    protectionTransactionId: txn.id,
    profileId: txn.profile_id,
    creatorUserId: txn.creator_user_id,
    grossAmount: amount,
    currency: txn.currency,
  });
  if (!inserted.ok) {
    if (inserted.reason === "exists") return { ok: true }; // lost a race — the earning exists either way
    return { ok: false };
  }
  return { ok: true };
}

/**
 * Releases a Protection transaction that is currently `awaiting_confirmation`, either by a
 * legitimate, verified customer confirming their own transaction, or by the auto-release job. Race-
 * safe by construction: the earning insert is claimed via a unique constraint
 * (commerce_sale_earnings_protection_transaction_id_idx) exactly like every other "exactly once"
 * insert in this codebase, and the status transition is claimed by the engine's own conditional
 * UPDATE — two concurrent callers can both attempt this, but only one earning row and one real
 * transition ever result; the other sees `alreadyReleased: true`.
 */
export async function releaseProtectionTransaction(deps: ProtectionReleaseDeps, transactionId: string, actor: ProtectionReleaseActor): Promise<ReleaseOutcome> {
  const txn = await deps.store.getProtectionTransaction(transactionId);
  if (!txn) return { ok: false, code: "not_found" };

  if (txn.status === "released") return { ok: true, status: "released", alreadyReleased: true };

  // Ownership: never trust anything but the server-resolved customerId. "system" (auto-release)
  // skips this — the engine's own actors list for this transition still only allows customer/system.
  if (actor.type === "customer" && txn.customer_id !== actor.customerId) return { ok: false, code: "unauthorized" };

  if (txn.status !== "awaiting_confirmation") return { ok: false, code: "not_eligible" };

  // 1. Earnings FIRST — see the file header for why. If this fails, the transaction is untouched.
  const earning = await ensureProtectionEarning(deps.store, txn);
  if (!earning.ok) {
    deps.log("protection_release_earnings_failed", { transactionId: txn.id });
    return { ok: false, code: "earnings_failed" };
  }

  // 2. Best-effort append-only audit trail (never blocks the release).
  try {
    await deps.store.recordReleaseLedgerEntry({
      protectionTransactionId: txn.id,
      amount: Number(txn.seller_protected_amount),
      currency: txn.currency,
      idempotencyKey: `protection-release-${txn.id}`,
    });
  } catch (err) {
    deps.log("protection_release_ledger_failed", { transactionId: txn.id, error: String((err as Error)?.message || err).slice(0, 120) });
  }

  // 3. ONLY NOW attempt the transition — the earning already exists regardless of this outcome.
  const engineActor: ProtectionActor = actor.type === "customer" ? { type: "customer", customerId: actor.customerId } : { type: "system" };
  const transitioned = await deps.transition(txn.id, "released", engineActor);
  if (!transitioned.ok) {
    const recheck = await deps.store.getProtectionTransaction(txn.id);
    if (recheck?.status === "released") return { ok: true, status: "released", alreadyReleased: true };
    // Exceedingly rare: the earning exists but the transition itself couldn't complete (e.g. the
    // transaction moved to `disputed` by an admin in the same instant). Never rolled back here —
    // financial reversal by code is riskier than a flagged manual reconciliation.
    deps.log("protection_release_transition_stuck", { transactionId: txn.id, code: transitioned.code });
    return { ok: false, code: "conflict" };
  }

  if (!transitioned.alreadyInStatus && deps.onReleased) {
    try {
      await deps.onReleased({ orderId: txn.target_id, protectionTransactionId: txn.id });
    } catch (err) {
      deps.log("protection_release_notify_failed", { transactionId: txn.id, error: String((err as Error)?.message || err).slice(0, 120) });
    }
  }

  return { ok: true, status: "released", alreadyReleased: transitioned.alreadyInStatus };
}

export interface AutoReleaseSummary {
  examined: number;
  released: number;
  alreadyReleased: number;
  skipped: number;
  errors: number;
}

/**
 * Bounded batch sweep, safe to run repeatedly and concurrently: each candidate goes through the
 * SAME releaseProtectionTransaction() a customer confirmation uses, with actor `{type:"system"}` —
 * two overlapping cron runs can both pick up the same id, but only one ever actually releases it.
 */
export async function autoReleaseEligibleProtectionTransactions(deps: ProtectionReleaseDeps, opts: { limit?: number } = {}): Promise<AutoReleaseSummary> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const ids = await deps.store.listAutoReleaseEligibleTransactionIds({ nowIso: new Date().toISOString(), limit });
  const summary: AutoReleaseSummary = { examined: 0, released: 0, alreadyReleased: 0, skipped: 0, errors: 0 };
  for (const id of ids) {
    summary.examined++;
    try {
      const outcome = await releaseProtectionTransaction(deps, id, { type: "system" });
      if (outcome.ok) {
        if (outcome.alreadyReleased) summary.alreadyReleased++;
        else summary.released++;
      } else {
        summary.skipped++;
      }
    } catch (err) {
      summary.errors++;
      deps.log("protection_auto_release_error", { transactionId: id, error: String((err as Error)?.message || err).slice(0, 160) });
    }
  }
  return summary;
}
