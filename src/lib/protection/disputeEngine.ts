// Ringo Protection — Phase 7: the ONE place a Protection dispute is ever opened or resolved. Pure
// and dependency-free, same discipline as engine.ts/release.ts. Every protection_transactions status
// change goes through the unmodified Phase 2 engine (deps.transition) — this file never writes
// protection_transactions.status directly. Release resolution reuses the unmodified Phase 6
// releaseProtectionTransaction() (deps.release) — never a second release/earnings implementation.
// Refund resolution reuses the unmodified Phase 3 requestProtectionRefund() (deps.requestRefund) —
// never a second refund-record implementation, and NEVER anything that moves real money (this file
// never imports fapshiRefundAdapter.ts, and requestProtectionRefund() itself only ever creates a
// `requested` protection_refunds row).

import { legalFromStatusesFor } from "./transitions";
import type { ProtectionActor, ProtectionStatus } from "./types";
import type { ProtectionDisputeRow, ProtectionDisputeStatus } from "./disputeTypes";

const ELIGIBLE_STATUSES = new Set<ProtectionStatus>(legalFromStatusesFor("disputed"));

export interface ProtectionDisputeTransactionRow {
  id: string;
  target_id: string; // product_orders.id
  status: ProtectionStatus;
  customer_id: string | null;
  profile_id: string;
}

export type InsertDisputeResult = { ok: true; row: ProtectionDisputeRow } | { ok: false; code: "exists" | "ineligible" };

export interface ProtectionDisputeStore {
  getProtectionTransaction(id: string): Promise<ProtectionDisputeTransactionRow | null>;
  getDisputeByProtectionTransaction(id: string): Promise<ProtectionDisputeRow | null>;
  insertDispute(row: { protectionTransactionId: string; orderId: string; customerId: string | null; profileId: string; reason: string; message: string | null }): Promise<InsertDisputeResult>;
  /** Only applies while the dispute is still `open`. Returns whether a row changed. */
  updateDisputeStatus(id: string, status: ProtectionDisputeStatus, resolvedByUserId: string): Promise<boolean>;
}

export type DisputeTransitionResult =
  | { ok: true; status: ProtectionStatus; alreadyInStatus: boolean }
  | { ok: false; code: string; status: ProtectionStatus | null };

/** Mirrors ReleaseOutcome's own shape (release.ts) — the exact type deps.release must return. */
export type ReleaseCallResult = { ok: true; status: "released"; alreadyReleased: boolean } | { ok: false; code: string };

/** Mirrors RefundOutcome's own shape (refundEngine.ts) — the exact type deps.requestRefund must return. */
export type RequestRefundCallResult = { ok: true; data: { id: string; status: string } } | { ok: false; code: string; data: unknown };

export interface ProtectionDisputeDeps {
  store: ProtectionDisputeStore;
  transition: (id: string, to: ProtectionStatus, actor: ProtectionActor) => Promise<DisputeTransitionResult>;
  /** The UNMODIFIED Phase 6 release function — reused, never duplicated. */
  release: (transactionId: string, actor: { type: "admin"; userId: string }) => Promise<ReleaseCallResult>;
  /** The UNMODIFIED Phase 3 refund-request function — reused, never duplicated. Never moves money. */
  requestRefund: (transactionId: string, opts: { reason?: string }) => Promise<RequestRefundCallResult>;
  onDisputeOpened?: (info: { orderId: string; protectionTransactionId: string; disputeId: string }) => Promise<void>;
  onDisputeResolvedRelease?: (info: { orderId: string; protectionTransactionId: string }) => Promise<void>;
  onDisputeResolvedRefund?: (info: { orderId: string; protectionTransactionId: string }) => Promise<void>;
  log: (event: string, data?: Record<string, unknown>) => void;
}

export type DisputeFailureCode = "not_found" | "unauthorized" | "not_eligible" | "invalid_request" | "conflict";

export type OpenDisputeOutcome = { ok: true; disputeId: string; alreadyOpen: boolean } | { ok: false; code: DisputeFailureCode };

const MAX_REASON_LEN = 100;
const MAX_MESSAGE_LEN = 2000;

/** Pure — no DB access. */
export function parseDisputeInput(raw: unknown): { ok: true; value: { reason: string; message: string | null } } | { ok: false; code: "invalid_request" } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, code: "invalid_request" };
  const r = raw as Record<string, unknown>;
  if (typeof r.reason !== "string") return { ok: false, code: "invalid_request" };
  const reason = r.reason.replace(/\s+/g, " ").trim().slice(0, MAX_REASON_LEN);
  if (reason.length < 1) return { ok: false, code: "invalid_request" };
  let message: string | null = null;
  if (r.message !== undefined && r.message !== null && r.message !== "") {
    if (typeof r.message !== "string") return { ok: false, code: "invalid_request" };
    message = r.message.trim().slice(0, MAX_MESSAGE_LEN) || null;
  }
  return { ok: true, value: { reason, message } };
}

/**
 * Opens a dispute for the customer's OWN Protection transaction. Idempotent: a repeated/duplicate
 * request (double tap, a retried API call) finds the SAME existing dispute row and never creates a
 * second one or attempts a second transition. Eligible source statuses are read directly from the
 * unmodified Phase 2 transition map (legalFromStatusesFor("disputed")) — never hard-coded here —
 * so this automatically preserves every entry point that map already allows (protected,
 * fulfillment_started, awaiting_confirmation), exactly as the Phase 7 spec requires.
 */
export async function openProtectionDispute(
  deps: ProtectionDisputeDeps,
  transactionId: string,
  customerId: string,
  input: { reason: string; message?: string | null }
): Promise<OpenDisputeOutcome> {
  const txn = await deps.store.getProtectionTransaction(transactionId);
  if (!txn) return { ok: false, code: "not_found" };

  // Ownership: never trust anything but the server-resolved customerId (from the session cookie).
  if (txn.customer_id !== customerId) return { ok: false, code: "unauthorized" };

  const existing = await deps.store.getDisputeByProtectionTransaction(txn.id);
  if (existing) return { ok: true, disputeId: existing.id, alreadyOpen: true };

  if (!ELIGIBLE_STATUSES.has(txn.status)) return { ok: false, code: "not_eligible" };

  const inserted = await deps.store.insertDispute({
    protectionTransactionId: txn.id,
    orderId: txn.target_id,
    customerId,
    profileId: txn.profile_id,
    reason: input.reason,
    message: input.message ?? null,
  });
  if (!inserted.ok) {
    if (inserted.code === "exists") {
      const again = await deps.store.getDisputeByProtectionTransaction(txn.id);
      if (again) return { ok: true, disputeId: again.id, alreadyOpen: true };
    }
    return { ok: false, code: inserted.code === "ineligible" ? "not_eligible" : "conflict" };
  }

  const transitioned = await deps.transition(txn.id, "disputed", { type: "customer", customerId });
  if (!transitioned.ok) {
    // The insert passed the DB's own live-status guard, but the engine's independent atomic check
    // found the transaction had moved on in the meantime (an exceedingly narrow double-race). The
    // dispute row itself is not rolled back — it stands as a truthful record an admin can still see —
    // but nothing here silently retries into a transition nobody asked for.
    deps.log("protection_dispute_transition_failed", { transactionId: txn.id, code: transitioned.code });
    return { ok: false, code: "conflict" };
  }

  if (!transitioned.alreadyInStatus && deps.onDisputeOpened) {
    try {
      await deps.onDisputeOpened({ orderId: txn.target_id, protectionTransactionId: txn.id, disputeId: inserted.row.id });
    } catch (err) {
      deps.log("protection_dispute_opened_notify_failed", { transactionId: txn.id, error: String((err as Error)?.message || err).slice(0, 120) });
    }
  }

  return { ok: true, disputeId: inserted.row.id, alreadyOpen: false };
}

export type ResolveFailureCode = "not_found" | "not_eligible" | "release_failed" | "refund_failed" | "conflict";

export type ResolveOutcome = { ok: true; alreadyResolved: boolean; resolution?: ProtectionDisputeStatus } | { ok: false; code: ResolveFailureCode };

/**
 * Admin resolves an open dispute toward release. Reuses Phase 6's releaseProtectionTransaction()
 * for the actual money-affecting step — this function only drives the dispute-specific transitions
 * (disputed -> resolved_release) around it.
 */
export async function resolveProtectionDisputeToRelease(deps: ProtectionDisputeDeps, transactionId: string, adminUserId: string): Promise<ResolveOutcome> {
  const txn = await deps.store.getProtectionTransaction(transactionId);
  if (!txn) return { ok: false, code: "not_found" };
  const dispute = await deps.store.getDisputeByProtectionTransaction(txn.id);
  if (!dispute) return { ok: false, code: "not_found" };

  // Release wins the race against a concurrent refund resolution the moment ITS dispute-level
  // transition wins the engine's own atomic conditional UPDATE — checked HERE, before any refund
  // has a chance to create a record (see resolveProtectionDisputeToRefund's own mirrored ordering).
  if (dispute.status === "resolved_refund") return { ok: true, alreadyResolved: true, resolution: "resolved_refund" };

  let justResolved = false;
  if (dispute.status === "open") {
    if (txn.status !== "disputed") return { ok: false, code: "not_eligible" };

    const transitioned = await deps.transition(txn.id, "resolved_release", { type: "admin", userId: adminUserId });
    if (!transitioned.ok) {
      const recheck = await deps.store.getDisputeByProtectionTransaction(txn.id);
      if (recheck && recheck.status !== "open") return { ok: true, alreadyResolved: true, resolution: recheck.status };
      deps.log("protection_dispute_resolve_release_transition_failed", { transactionId: txn.id, code: transitioned.code });
      return { ok: false, code: "conflict" };
    }
    if (!transitioned.alreadyInStatus) {
      await deps.store.updateDisputeStatus(dispute.id, "resolved_release", adminUserId);
      justResolved = true;
    }
  }

  // The dispute is now (or already was) resolved_release — ensure the release actually completes.
  // The SAME, unmodified Phase 6 release mechanism, never a duplicate — and itself idempotent, so
  // retrying it here (e.g. after an earlier attempt's release_failed) is always safe and never
  // creates a second earning.
  const released = await deps.release(txn.id, { type: "admin", userId: adminUserId });
  if (!released.ok) {
    deps.log("protection_dispute_release_failed", { transactionId: txn.id, code: released.code });
    return { ok: false, code: "release_failed" };
  }

  if (justResolved && deps.onDisputeResolvedRelease) {
    try {
      await deps.onDisputeResolvedRelease({ orderId: txn.target_id, protectionTransactionId: txn.id });
    } catch (err) {
      deps.log("protection_dispute_resolved_release_notify_failed", { transactionId: txn.id, error: String((err as Error)?.message || err).slice(0, 120) });
    }
  }

  return { ok: true, alreadyResolved: !justResolved, resolution: "resolved_release" };
}

/**
 * Admin resolves an open dispute toward refund. Creates/ensures exactly one `protection_refunds` row
 * via the UNMODIFIED Phase 3 requestProtectionRefund() — which only ever reaches `requested`, never
 * calls Fapshi, and never marks anything `refunded`. The Protection transaction itself moves to
 * `resolved_refund` (a real, legal transition already in the Phase 2 map) — but Phase 7 deliberately
 * goes no further than that: `resolved_refund -> refunded` requires an ACTUALLY completed provider
 * refund, which stays capability-gated and disabled (see fapshiRefundAdapter.ts).
 */
export async function resolveProtectionDisputeToRefund(deps: ProtectionDisputeDeps, transactionId: string, adminUserId: string, opts: { reason?: string } = {}): Promise<ResolveOutcome> {
  const txn = await deps.store.getProtectionTransaction(transactionId);
  if (!txn) return { ok: false, code: "not_found" };
  const dispute = await deps.store.getDisputeByProtectionTransaction(txn.id);
  if (!dispute) return { ok: false, code: "not_found" };

  // Mirrors resolveProtectionDisputeToRelease's own ordering exactly, and for the same reason: the
  // ATOMIC dispute-level transition happens BEFORE any supporting record is created, so a losing
  // concurrent attempt (release won the race instead) is discovered and stopped here — before a
  // stray protection_refunds row could ever be created for a transaction that is actually released.
  if (dispute.status === "resolved_release") return { ok: true, alreadyResolved: true, resolution: "resolved_release" };

  let justResolved = false;
  if (dispute.status === "open") {
    if (txn.status !== "disputed") return { ok: false, code: "not_eligible" };

    const transitioned = await deps.transition(txn.id, "resolved_refund", { type: "admin", userId: adminUserId });
    if (!transitioned.ok) {
      const recheck = await deps.store.getDisputeByProtectionTransaction(txn.id);
      if (recheck && recheck.status !== "open") return { ok: true, alreadyResolved: true, resolution: recheck.status };
      deps.log("protection_dispute_resolve_refund_transition_failed", { transactionId: txn.id, code: transitioned.code });
      return { ok: false, code: "conflict" };
    }
    if (!transitioned.alreadyInStatus) {
      await deps.store.updateDisputeStatus(dispute.id, "resolved_refund", adminUserId);
      justResolved = true;
    }
  }

  // The dispute is now (or already was) resolved_refund — ensure the protection_refunds record
  // exists. requestProtectionRefund() (Phase 3, unmodified) is itself idempotent, so retrying it
  // here (e.g. after an earlier attempt's refund_failed) is always safe and never duplicates.
  const refundRequested = await deps.requestRefund(txn.id, { reason: opts.reason });
  if (!refundRequested.ok) {
    deps.log("protection_dispute_refund_request_failed", { transactionId: txn.id, code: refundRequested.code });
    return { ok: false, code: "refund_failed" };
  }

  if (justResolved && deps.onDisputeResolvedRefund) {
    try {
      await deps.onDisputeResolvedRefund({ orderId: txn.target_id, protectionTransactionId: txn.id });
    } catch (err) {
      deps.log("protection_dispute_resolved_refund_notify_failed", { transactionId: txn.id, error: String((err as Error)?.message || err).slice(0, 120) });
    }
  }

  return { ok: true, alreadyResolved: !justResolved, resolution: "resolved_refund" };
}
