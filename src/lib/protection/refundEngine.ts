import { transitionProtectionTransaction } from "./engine";
import type { ProtectionRefundDestination, ProtectionRefundStatus, ProviderPayoutStatus } from "./refundTypes";

// Ringo Protection — Phase 3 refund domain module. The single authoritative place a
// protection_refunds row is ever created or moved — mirrors engine.ts being the one place
// protection_transactions.status changes.
//
// Phase 12: requestProtectionRefund is called from dispute resolution (disputeEngine.ts), and
// recordManualProtectionRefundOutcome (below) is called from the admin manual-refund route — the
// admin/operator sends the actual Mobile Money transfer themselves, outside this codebase, using
// Fapshi's own operational interface, and this function only RECORDS that already-happened result.
// No live Fapshi call is ever made by anything in this file — see fapshiRefundAdapter.ts for the
// one function that CAN make a real fapshiPayout() call, which stays dormant and unwired
// (protection_refund_provider_enabled remains false; automatic provider refunds are a future phase).
//
// Money safety is enforced in THREE independent layers, not just here:
//   1. protection_refunds_amount_guard_trg (DB trigger) — refund_amount can never exceed the
//      transaction's own snapshotted seller_protected_amount, checked on INSERT.
//   2. protection_refunds.protection_transaction_id UNIQUE — at most one refund row can ever
//      exist per protected transaction, full stop; a duplicate request finds the existing row.
//   3. protection_refunds_guard_trg (DB trigger) — completed/failed are enforced terminal
//      (except failed -> processing, an explicit, safe retry path); no backward/lateral move.
//
// A completed refund only ever moves the parent protection_transaction to 'refunded' by calling
// the UNMODIFIED Phase 2 transitionProtectionTransaction() — which itself only accepts
// resolved_refund -> refunded, so a refund can never complete into a transaction an admin hasn't
// already explicitly dispute-resolved. No commerce_sale_earnings interaction anywhere in this file.
type Admin = any;

const UNIQUE_VIOLATION = "23505";

export type RefundFailureCode = "not_found" | "already_exists" | "not_refundable" | "conflict" | "amount_exceeds_protected";

export type RefundOutcome<T = { id: string; status: ProtectionRefundStatus }> = { ok: true; data: T } | { ok: false; code: RefundFailureCode; data: T | null };

/**
 * Creates the (at most one, ever) refund record for a protected transaction, snapshotting the
 * refund amount from the transaction's own protected amount at this moment. Idempotent: calling
 * this twice for the same transaction returns the SAME existing row the second time, never a
 * second row (enforced by the DB's own unique constraint, not just this check).
 */
export async function requestProtectionRefund(
  admin: Admin,
  protectionTransactionId: string,
  opts: { reason?: string; idempotencyKey?: string } = {}
): Promise<RefundOutcome> {
  const { data: txn, error: readError } = await admin
    .from("protection_transactions")
    .select("id, status, target_id, customer_id, currency, seller_protected_amount")
    .eq("id", protectionTransactionId)
    .maybeSingle();
  if (readError) throw new Error(`protection_transactions read failed (${readError.code || "error"})`);
  if (!txn) return { ok: false, code: "not_found", data: null };
  if (txn.status === "released" || txn.status === "refunded") {
    return { ok: false, code: "not_refundable", data: null };
  }

  const { data: inserted, error: insertError } = await admin
    .from("protection_refunds")
    .insert({
      protection_transaction_id: protectionTransactionId,
      order_id: txn.target_id,
      customer_id: txn.customer_id,
      refund_amount: txn.seller_protected_amount,
      currency: txn.currency,
      reason: opts.reason ?? null,
      idempotency_key: opts.idempotencyKey ?? null,
    })
    .select("id, status")
    .maybeSingle();

  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION) {
      const { data: existing } = await admin.from("protection_refunds").select("id, status").eq("protection_transaction_id", protectionTransactionId).maybeSingle();
      return existing ? { ok: true, data: existing } : { ok: false, code: "conflict", data: null };
    }
    // The amount-guard trigger raises on refund_amount exceeding the protected amount — surfaced
    // as its own code rather than a generic throw, since it's a real, expected outcome to test for.
    if (String(insertError.message || "").includes("exceeds the protected amount")) {
      return { ok: false, code: "amount_exceeds_protected", data: null };
    }
    throw new Error(`protection_refunds insert failed (${insertError.code || "error"}): ${insertError.message || ""}`);
  }

  return { ok: true, data: inserted };
}

/**
 * Claims a requested (or previously failed) refund for processing and records the destination —
 * conditional UPDATE, race-safe the same way engine.ts's transitions are. If the refund is
 * already `processing`, this call finds nothing to claim and returns `conflict` — the caller must
 * reconcile the existing attempt's provider status (reconcileProtectionRefundPayout) rather than
 * starting a second one. This is what makes "retry after a network failure reconciles first"
 * structural rather than a rule callers have to remember.
 */
export async function beginProtectionRefundProcessing(
  admin: Admin,
  refundId: string,
  destination: ProtectionRefundDestination
): Promise<RefundOutcome> {
  const { data: updated, error } = await admin
    .from("protection_refunds")
    .update({
      status: "processing",
      destination_phone: destination.phone,
      destination_network: destination.network,
      processing_started_at: new Date().toISOString(),
    })
    .eq("id", refundId)
    .in("status", ["requested", "failed"])
    .select("id, status");
  if (error) throw new Error(`protection_refunds processing claim failed (${error.code || "error"})`);

  if (!updated || updated.length === 0) {
    const { data: recheck } = await admin.from("protection_refunds").select("id, status").eq("id", refundId).maybeSingle();
    if (!recheck) return { ok: false, code: "not_found", data: null };
    return { ok: false, code: "conflict", data: recheck };
  }
  return { ok: true, data: updated[0] };
}

/**
 * Marks a refund completed ONLY from `processing`, then — and only then — transitions the parent
 * protection_transaction to `refunded` via the unmodified Phase 2 engine (which itself only
 * accepts resolved_refund -> refunded). Never called speculatively: only after the caller has
 * verified the provider actually confirmed success (see reconcileProtectionRefundPayout).
 */
export async function completeProtectionRefund(
  admin: Admin,
  refundId: string,
  opts: { providerReference: string; providerStatus: string }
): Promise<RefundOutcome> {
  const { data: updated, error } = await admin
    .from("protection_refunds")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      provider_reference: opts.providerReference,
      provider_status: opts.providerStatus,
    })
    .eq("id", refundId)
    .eq("status", "processing")
    .select("id, status, protection_transaction_id");
  if (error) throw new Error(`protection_refunds completion failed (${error.code || "error"})`);

  if (!updated || updated.length === 0) {
    const { data: recheck } = await admin.from("protection_refunds").select("id, status").eq("id", refundId).maybeSingle();
    if (!recheck) return { ok: false, code: "not_found", data: null };
    // Lost a race to another completion, or this refund was never in `processing` — either way,
    // if it's ALREADY completed that's a graceful no-op, never a second protection_transactions
    // transition attempt (transitionProtectionTransaction is itself idempotent too, but we don't
    // even need to call it again here).
    if (recheck.status === "completed") return { ok: true, data: recheck };
    return { ok: false, code: "conflict", data: recheck };
  }

  const row = updated[0];
  await transitionProtectionTransaction(admin, row.protection_transaction_id, "refunded", { type: "system" });

  return { ok: true, data: { id: row.id, status: row.status } };
}

/**
 * Marks a refund failed ONLY from `processing`. Deliberately does NOT touch the parent
 * protection_transaction at all — it stays exactly where it was (resolved_refund), never
 * `refunded`, so money is never considered returned when it wasn't.
 */
export async function failProtectionRefund(
  admin: Admin,
  refundId: string,
  opts: { failureReason: string; providerStatus?: string }
): Promise<RefundOutcome> {
  const { data: updated, error } = await admin
    .from("protection_refunds")
    .update({
      status: "failed",
      failed_at: new Date().toISOString(),
      failure_reason: opts.failureReason.slice(0, 500),
      provider_status: opts.providerStatus ?? null,
    })
    .eq("id", refundId)
    .eq("status", "processing")
    .select("id, status");
  if (error) throw new Error(`protection_refunds failure recording failed (${error.code || "error"})`);

  if (!updated || updated.length === 0) {
    const { data: recheck } = await admin.from("protection_refunds").select("id, status").eq("id", refundId).maybeSingle();
    if (!recheck) return { ok: false, code: "not_found", data: null };
    if (recheck.status === "failed") return { ok: true, data: recheck };
    return { ok: false, code: "conflict", data: recheck };
  }
  return { ok: true, data: updated[0] };
}

/**
 * Reconciles a `processing` refund's actual provider state — never trusts a timeout/network error
 * as success OR failure; a status of CREATED (still in flight at the provider) leaves the refund
 * exactly as `processing`, unchanged, so a later reconciliation can try again. Mirrors
 * /api/admin/shop/payouts/[id]/check's own reconciliation shape exactly (the existing, proven
 * pattern for "ask the provider directly, never guess"). `checkStatus` is injected — in this
 * phase nothing supplies the real fapshiGetStatus, so this can be fully tested without ever
 * reaching Fapshi.
 */
export async function reconcileProtectionRefundPayout(
  admin: Admin,
  refundId: string,
  checkStatus: (providerReference: string) => Promise<{ status: ProviderPayoutStatus; reason?: string | null }>
): Promise<RefundOutcome<{ id: string; status: ProtectionRefundStatus; providerStatus: ProviderPayoutStatus | "unknown" }>> {
  const { data: refund, error } = await admin.from("protection_refunds").select("id, status, provider_reference").eq("id", refundId).maybeSingle();
  if (error) throw new Error(`protection_refunds read failed (${error.code || "error"})`);
  if (!refund) return { ok: false, code: "not_found", data: null };
  if (refund.status !== "processing" || !refund.provider_reference) {
    return { ok: false, code: "conflict", data: { id: refund.id, status: refund.status, providerStatus: "unknown" } };
  }

  let tx: { status: ProviderPayoutStatus; reason?: string | null };
  try {
    tx = await checkStatus(refund.provider_reference);
  } catch {
    // A network/provider error while checking is exactly the "unknown" case — never mapped to
    // success or failure. The refund stays `processing`; a later reconciliation tries again.
    return { ok: true, data: { id: refund.id, status: "processing", providerStatus: "unknown" } };
  }

  if (tx.status === "SUCCESSFUL") {
    const outcome = await completeProtectionRefund(admin, refundId, { providerReference: refund.provider_reference, providerStatus: tx.status });
    return outcome.ok
      ? { ok: true, data: { id: outcome.data!.id, status: outcome.data!.status, providerStatus: tx.status } }
      : { ok: false, code: outcome.code, data: null };
  }
  if (tx.status === "FAILED" || tx.status === "EXPIRED") {
    const outcome = await failProtectionRefund(admin, refundId, { failureReason: tx.reason || `Fapshi payout ${tx.status.toLowerCase()}`, providerStatus: tx.status });
    return outcome.ok
      ? { ok: true, data: { id: outcome.data!.id, status: outcome.data!.status, providerStatus: tx.status } }
      : { ok: false, code: outcome.code, data: null };
  }
  // CREATED: still in flight at the provider — not a timeout, not a failure, not a success.
  return { ok: true, data: { id: refund.id, status: "processing", providerStatus: tx.status } };
}

const NETWORKS = new Set<ProtectionRefundDestination["network"]>(["mtn", "orange"]);

function normalizeManualPhone(phone: string): string {
  let digits = phone.replace(/[^0-9]/g, "");
  if (digits.startsWith("237") && digits.length > 9) digits = digits.slice(3);
  return digits;
}

export type ParseManualRefundFailureCode = "invalid_request" | "invalid_phone" | "invalid_network" | "invalid_reference" | "invalid_reason";

export type ManualRefundInput =
  | { outcome: "completed"; destination: ProtectionRefundDestination; providerReference: string }
  | { outcome: "failed"; destination: ProtectionRefundDestination; failureReason: string };

/**
 * Pure — no DB access. The admin/operator has ALREADY sent (or attempted) the transfer manually via
 * Fapshi's own operational interface; this only validates the shape of what they're reporting back.
 * The destination is always admin-supplied here — never inferred from product_orders.customer_phone
 * or any other assumed source (see Phase 12 spec section 6).
 */
export function parseManualRefundInput(raw: unknown): { ok: true; value: ManualRefundInput } | { ok: false; code: ParseManualRefundFailureCode } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, code: "invalid_request" };
  const r = raw as Record<string, unknown>;
  if (r.outcome !== "completed" && r.outcome !== "failed") return { ok: false, code: "invalid_request" };
  if (typeof r.destinationPhone !== "string") return { ok: false, code: "invalid_phone" };
  const phone = normalizeManualPhone(r.destinationPhone);
  if (!/^6\d{8}$/.test(phone)) return { ok: false, code: "invalid_phone" };
  if (typeof r.destinationNetwork !== "string" || !NETWORKS.has(r.destinationNetwork as any)) return { ok: false, code: "invalid_network" };
  const destination: ProtectionRefundDestination = { phone, network: r.destinationNetwork as ProtectionRefundDestination["network"] };

  if (r.outcome === "completed") {
    if (typeof r.providerReference !== "string" || r.providerReference.trim().length < 1) return { ok: false, code: "invalid_reference" };
    return { ok: true, value: { outcome: "completed", destination, providerReference: r.providerReference.trim().slice(0, 200) } };
  }
  if (typeof r.failureReason !== "string" || r.failureReason.trim().length < 1) return { ok: false, code: "invalid_reason" };
  return { ok: true, value: { outcome: "failed", destination, failureReason: r.failureReason.trim().slice(0, 500) } };
}

/**
 * Records the outcome of a refund transfer the admin/operator performed MANUALLY, outside this
 * codebase, via Fapshi's own operational interface — this function never calls Fapshi itself (see
 * fapshiRefundAdapter.ts, which stays dormant). Composes the existing
 * beginProtectionRefundProcessing + completeProtectionRefund/failProtectionRefund primitives rather
 * than adding a second refund-mutation path. The refund amount is never taken from the caller — it
 * stays exactly the snapshot requestProtectionRefund() recorded (see Phase 12 spec section 9).
 * Idempotent: an already-completed or already-failed refund is rejected as a conflict rather than
 * silently reprocessed; a refund stuck in `processing` from an interrupted previous call (e.g. a
 * crash between the begin and complete/fail steps) is safely resumed rather than re-claimed.
 */
export async function recordManualProtectionRefundOutcome(admin: Admin, refundId: string, input: ManualRefundInput): Promise<RefundOutcome> {
  const claimed = await beginProtectionRefundProcessing(admin, refundId, input.destination);
  if (!claimed.ok) {
    if (claimed.code !== "conflict" || claimed.data?.status !== "processing") return claimed;
    // Resume: a previous attempt already claimed this refund for processing (destination was
    // recorded then) but never reached completed/failed — proceed to record the outcome now.
  }

  if (input.outcome === "completed") {
    return completeProtectionRefund(admin, refundId, { providerReference: input.providerReference, providerStatus: "MANUAL_CONFIRMED" });
  }
  return failProtectionRefund(admin, refundId, { failureReason: input.failureReason, providerStatus: "MANUAL_FAILED" });
}
