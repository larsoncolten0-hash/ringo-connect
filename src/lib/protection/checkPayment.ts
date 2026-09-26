// Ringo Protection — Phase 4 payment status + settlement. Asks Fapshi (never trusts the client),
// settles a success exactly once via settleProtectionPayment, records failed/expired attempts, and
// applies lazy expiry. Safe to call repeatedly: polling, refreshes and retries all converge.
//
// Settlement is intentionally re-entrant and idempotent (every step is a conditional claim), exactly
// like productCheckout/settlement.ts — but it NEVER creates a commerce_sale_earnings row and never
// calls settlement.ts. The only things it ever writes are: this protection_payments row, the parent
// protection_transactions row (exclusively via the unmodified Phase 2 transitionProtectionTransaction,
// injected as deps.transition), and — only for the caller that actually protects the transaction —
// the underlying product_orders row's status/paid_at (the SAME already-legal awaiting_payment->paid
// transition Normal Payment uses, applied directly here rather than through settlement.ts so no
// earning is ever recorded).

import { LATE_CONFIRMATION_LOOKBACK_HOURS, VERIFY_PROVIDER_AMOUNT } from "./checkoutConstants";
import { fail, ok, type Result } from "./checkoutErrors";
import { toProtectionTransactionView, type ProtectionCheckoutDeps, type ProtectionPaymentRow, type ProtectionTransactionRow, type ProtectionTransactionView, type ProviderStatus } from "./checkoutTypes";

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export type ProtectionPaymentState = "not_started" | "pending" | "succeeded" | "failed" | "expired";

export type { ProtectionTransactionView };

export interface ProtectionPaymentStatusView {
  status: ProtectionPaymentState;
  transaction: ProtectionTransactionView;
  expires_at?: string;
}

function toTxnView(row: ProtectionTransactionRow): ProtectionTransactionView {
  return toProtectionTransactionView(row, null);
}

function toCents(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function normalizeProviderStatus(status: ProviderStatus | string | null | undefined): "pending" | "succeeded" | "failed" | "expired" {
  switch (status) {
    case "SUCCESSFUL":
      return "succeeded";
    case "FAILED":
      return "failed";
    case "EXPIRED":
      return "expired";
    default:
      return "pending";
  }
}

// eslint-disable-next-line no-control-regex
const safeReason = (r: string | null | undefined) => (r ? r.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) || null : null);
const isLive = (p: ProtectionPaymentRow, nowMs: number) => (p.status === "initiated" || p.status === "pending") && new Date(p.expires_at).getTime() > nowMs;

export interface SettleOutcome {
  status: "succeeded" | "failed";
  /** true only for the caller that actually flipped the transaction to `protected` */
  settledNow: boolean;
}

/**
 * Confirms a succeeded payment and — exactly once — protects the transaction. Money-safe: a
 * payment/transaction amount or currency mismatch NEVER results in `protected`; Protection's
 * frozen (Phase 1/2) status enum has no "review" escape hatch the way product_orders does, so a
 * mismatch is logged loudly and the transaction is moved to the existing `payment_failed` terminal
 * state instead — a known, documented Phase 4 limitation (see the audit), not a silent success.
 */
export async function settleProtectionPayment(deps: ProtectionCheckoutDeps, paymentId: string, facts: { amount: number | null }): Promise<SettleOutcome> {
  let payment = await deps.store.getProtectionPayment(paymentId);
  if (!payment) return { status: "failed", settledNow: false };

  const txn = await deps.store.getProtectionTransaction(payment.protection_transaction_id);
  if (!txn) {
    // The money is real: still record the payment as succeeded so it is never lost, then hand to a human.
    await deps.store.updateProtectionPayment(payment.id, { status: "succeeded", confirmed_at: deps.now().toISOString(), provider_status: "SUCCESSFUL" }, [
      "initiated",
      "pending",
      "expired",
      "cancelled",
    ]);
    deps.log("protection_payment_orphaned", { paymentId, reason: "transaction_missing" });
    return { status: "failed", settledNow: false };
  }

  // 1. Claim the payment as succeeded (exactly one caller wins; the rest continue in converge mode).
  if (payment.status !== "succeeded") {
    const claimed = await deps.store.updateProtectionPayment(payment.id, { status: "succeeded", confirmed_at: deps.now().toISOString(), provider_status: "SUCCESSFUL" }, [
      "initiated",
      "pending",
      "expired",
      "cancelled",
    ]);
    if (!claimed) {
      const again = await deps.store.getProtectionPayment(payment.id);
      if (!again || again.status !== "succeeded") {
        deps.log("protection_payment_status_conflict", { paymentId, transactionId: txn.id });
        return { status: "failed", settledNow: false };
      }
      payment = again;
    } else {
      payment = { ...payment, status: "succeeded" };
    }
  }

  // 2. The payment must match the transaction's own snapshot. Anything else -> payment_failed, never protected.
  const paymentCents = toCents(payment.amount);
  const totalCents = toCents(txn.customer_total);
  const mismatch =
    payment.currency !== txn.currency ||
    paymentCents === null ||
    totalCents === null ||
    paymentCents !== totalCents ||
    (VERIFY_PROVIDER_AMOUNT && facts.amount !== null && facts.amount !== undefined && toCents(facts.amount) !== paymentCents);
  if (mismatch) {
    deps.log("protection_payment_mismatch", { paymentId, transactionId: txn.id });
    if (txn.status === "awaiting_payment") await deps.transition(txn.id, "payment_failed", { type: "system" });
    return { status: "failed", settledNow: false };
  }

  // 3. Protect the transaction — exactly once, via the unmodified Phase 2 engine.
  let settledNow = false;
  if (txn.status === "awaiting_payment") {
    const result = await deps.transition(txn.id, "protected", { type: "system" });
    if (result.ok) {
      settledNow = !result.alreadyInStatus;
    } else {
      const recheck = await deps.store.getProtectionTransaction(txn.id);
      if (!recheck || recheck.status !== "protected") {
        deps.log("protection_transition_conflict", { transactionId: txn.id, code: result.code });
        return { status: "failed", settledNow: false };
      }
    }
  }

  // 4. Side effects ONLY for the caller that actually protected it — flip the underlying order to
  //    `paid` (the same already-legal awaiting_payment->paid transition; NEVER via settlement.ts, so
  //    NO commerce_sale_earnings row is ever created here) and fire the best-effort notification hook.
  if (settledNow) {
    const order = await deps.store.getOrder(txn.target_id);
    if (order && order.status === "awaiting_payment") {
      await deps.store.updateOrder(order.id, { status: "paid", paid_at: deps.now().toISOString() }, "awaiting_payment");
    }
    if (deps.onProtected) {
      try {
        await deps.onProtected({ orderId: txn.target_id, protectionTransactionId: txn.id });
      } catch (err) {
        deps.log("protection_protected_hook_failed", { transactionId: txn.id, error: String((err as Error)?.message || err).slice(0, 120) });
      }
    }
  }

  return { status: "succeeded", settledNow };
}

export async function checkProtectionPayment(deps: ProtectionCheckoutDeps, transactionId: string): Promise<Result<ProtectionPaymentStatusView>> {
  if (!isUuid(transactionId)) return fail("transaction_not_found");
  let txn = await deps.store.getProtectionTransaction(transactionId);
  if (!txn) return fail("transaction_not_found");
  const nowMs = deps.now().getTime();

  const build = async (state: ProtectionPaymentState, extra: Partial<ProtectionPaymentStatusView> = {}): Promise<Result<ProtectionPaymentStatusView>> => {
    const latest = (await deps.store.getProtectionTransaction(transactionId)) ?? txn!;
    return ok({ status: state, transaction: toTxnView(latest), ...extra });
  };
  const stateForTerminal = (status: ProtectionTransactionRow["status"]): ProtectionPaymentState | null => {
    if (status === "payment_failed") return "failed";
    if (status === "expired" || status === "cancelled") return "expired";
    if (status !== "awaiting_payment") return "succeeded"; // protected or any status beyond it
    return null;
  };

  let payments = await deps.store.listProtectionPayments(transactionId);

  // 1. A payment we already recorded as succeeded: re-run settlement (idempotent).
  const earliestSuccess = [...payments].reverse().find((p) => p.status === "succeeded");
  if (earliestSuccess) {
    const outcome = await settleProtectionPayment(deps, earliestSuccess.id, { amount: null });
    return build(outcome.status === "succeeded" ? "succeeded" : "failed");
  }

  const terminal = stateForTerminal(txn.status);
  if (terminal) return build(terminal);

  // 2. Ask the provider about open attempts and recently expired/cancelled ones.
  const cutoff = nowMs - LATE_CONFIRMATION_LOOKBACK_HOURS * 3_600_000;
  const candidates = payments
    .filter(
      (p) =>
        !!p.provider_transaction_id &&
        (p.status === "initiated" || p.status === "pending" || ((p.status === "expired" || p.status === "cancelled") && new Date(p.created_at).getTime() > cutoff))
    )
    .slice(0, 3);

  for (const p of candidates) {
    if (deps.pollGate && !deps.pollGate.tryAcquire(p.provider_transaction_id as string, nowMs)) continue;
    let tx: { status: ProviderStatus; amount: number | null; reason?: string | null };
    try {
      tx = await deps.provider.getStatus(p.provider_transaction_id as string);
    } catch (err) {
      deps.log("protection_provider_status_error", { paymentId: p.id, error: String((err as Error)?.message || err).slice(0, 160) });
      continue;
    }
    const state = normalizeProviderStatus(tx.status);
    if (state === "succeeded") {
      const outcome = await settleProtectionPayment(deps, p.id, { amount: tx.amount });
      return build(outcome.status === "succeeded" ? "succeeded" : "failed");
    }
    if (state === "failed") {
      await deps.store.updateProtectionPayment(p.id, { status: "failed", provider_status: "FAILED", failure_reason: safeReason(tx.reason) }, ["initiated", "pending"]);
    } else if (state === "expired") {
      await deps.store.updateProtectionPayment(p.id, { status: "expired", provider_status: "EXPIRED" }, ["initiated", "pending"]);
    } else if ((p.status === "initiated" || p.status === "pending") && new Date(p.expires_at).getTime() <= nowMs) {
      await deps.store.updateProtectionPayment(p.id, { status: "expired", provider_status: String(tx.status) }, ["initiated", "pending"]);
    }
  }

  payments = await deps.store.listProtectionPayments(transactionId);
  txn = (await deps.store.getProtectionTransaction(transactionId)) ?? txn;

  // 3. Lazy expiry: unpaid, order past its window, nothing live -> expire the transaction and release stock.
  const live = payments.find((p) => isLive(p, nowMs));
  if (txn.status === "awaiting_payment" && !live) {
    const order = await deps.store.getOrder(txn.target_id);
    if (order && order.status === "awaiting_payment" && new Date(order.expires_at).getTime() <= nowMs) {
      await deps.transition(txn.id, "expired", { type: "system" });
      await deps.store.releaseOrder(order.id, "expired");
      txn = (await deps.store.getProtectionTransaction(transactionId)) ?? txn;
    }
  }

  const terminalAfter = stateForTerminal(txn.status);
  if (terminalAfter) return build(terminalAfter);
  if (live) return build("pending", { expires_at: live.expires_at });

  const latest = payments[0];
  if (!latest) return build("not_started");
  if (latest.status === "failed") return build("failed");
  return build("expired");
}
