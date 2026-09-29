// Ambassador Program — Ringo Management payout actions.
//
// Called only from assertAdmin()-gated routes (the acting admin's id comes from
// that verified session, never the body) — except checkPayoutFapshi, which the
// reconciler also calls with a null (system) actor; it only ever finalizes what
// Fapshi itself reports for a known transaction.
//
// EVERY state change now goes through a SQL state-machine function
// (2026-11-26_ambassador_financial_hardening.sql); application code performs
// NO direct write to ambassador_payouts or the ledger. Those functions lock
// the payout then its ledger rows, verify the linked rows still qualify and sum
// to the payout amount, and refuse illegal transitions.
//
// DISBURSEMENT SAFETY
//  - The payout is CLAIMED (requested -> processing) by ambassador_claim_payout
//    BEFORE Fapshi is called; only the caller that wins the claim may call it,
//    and each attempt gets its own disbursement_key, sent to Fapshi as the
//    external id.
//  - Fapshi's answer is classified (see fapshiLimits.classifyFapshiPayoutError):
//      definitive / not_sent  -> the claim is released; the payout is retryable
//      uncertain (timeout, 5xx, 429, 408, 409, lost/unreadable response,
//                 accepted-but-no-id, accepted-but-not-recorded)
//                             -> the payout goes to reconciliation_required.
//    An uncertain payout is NEVER re-sent automatically and its commission rows
//    stay linked to it (they do not rejoin the ordinary eligible balance). It is
//    resolved only by Fapshi's own status for a known transaction id, or by an
//    admin's explicit, noted, audited decision (resolveUncertainPayout).
import { fapshiPayout, fapshiGetStatus } from "@/lib/fapshi";
import { classifyFapshiPayoutError, fapshiMinDisbursementXaf } from "@/lib/ambassador/fapshiLimits";
import { notifyPayoutStatus, notifyCommissionReversed } from "@/lib/ambassador/notifications";

export type AdminPayoutErrorCode =
  | "not_found"
  | "not_authorized"
  | "not_claimable"
  | "wrong_currency"
  | "wrong_method"
  | "bad_destination"
  | "non_integer_amount"
  | "amount_too_small"
  | "ledger_mismatch"
  | "fapshi_rejected"
  | "fapshi_ambiguous"
  | "not_in_flight"
  | "not_confirmed"
  | "not_resolvable"
  | "transaction_id_required"
  | "transaction_id_in_use"
  | "invalid_input"
  | "payout_in_flight"
  | "already_reversed"
  | "failed";

type Result<T = {}> = ({ ok: true } & T) | { ok: false; code: AdminPayoutErrorCode; status: number };
const fail = (code: AdminPayoutErrorCode, status: number): { ok: false; code: AdminPayoutErrorCode; status: number } => ({ ok: false, code, status });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const PAYOUT_COLUMNS = "id, recipient_type, recipient_user_id, amount, currency, status, payout_method, payout_details, fapshi_trans_id, claimed_at";

// Maps a SQL function's `reason` to an API result. One table, so every action
// reports database refusals the same way.
const REASONS: Record<string, [AdminPayoutErrorCode, number]> = {
  not_found: ["not_found", 404],
  not_authorized: ["not_authorized", 403],
  not_claimable: ["not_claimable", 409],
  not_releasable: ["not_claimable", 409],
  not_recordable: ["not_claimable", 409],
  not_failable: ["not_in_flight", 409],
  not_markable: ["not_claimable", 409],
  not_processable: ["not_claimable", 409],
  not_rejectable: ["not_claimable", 409],
  not_reconcilable: ["not_resolvable", 409],
  has_transaction: ["not_resolvable", 409],
  ledger_mismatch: ["ledger_mismatch", 409],
  transaction_mismatch: ["ledger_mismatch", 409],
  transaction_id_required: ["transaction_id_required", 400],
  invalid_transaction_id: ["transaction_id_required", 400],
  transaction_id_in_use: ["transaction_id_in_use", 409],
  invalid_input: ["invalid_input", 400],
  invalid_reason: ["invalid_input", 400],
  payout_in_progress: ["payout_in_flight", 409],
  already_reversed: ["already_reversed", 409],
};
const refusal = (reason: unknown) => {
  const [code, status] = REASONS[String(reason)] ?? ["failed", 500];
  return fail(code, status);
};

async function audit(admin: any, actorId: string | null, action: string, targetId: string, after: Record<string, unknown>, reason: string | null) {
  try {
    const { error } = await admin.rpc("ambassador_log_action", {
      p_actor_user_id: actorId,
      p_action: action,
      p_target_table: "ambassador_payouts",
      p_target_id: targetId,
      p_before: null,
      p_after: after,
      p_reason: reason,
    });
    if (error) console.error("ambassador_log_action failed:", error.message);
  } catch (err: any) {
    console.error("ambassador_log_action threw:", err?.message);
  }
}

/** Calls a state-machine function; a transport error is a generic failure. */
async function rpc(admin: any, name: string, args: Record<string, unknown>): Promise<{ ok: true; data: any } | { ok: false; refused: ReturnType<typeof fail> }> {
  const { data, error } = await admin.rpc(name, args);
  if (error) {
    console.error(`${name} failed:`, error.message);
    return { ok: false, refused: fail("failed", 500) };
  }
  if (!data?.ok) return { ok: false, refused: refusal(data?.reason) };
  return { ok: true, data };
}

// ------------------------------------------------------------ mark eligible

/** Releases earned commissions for payout. The DATABASE function only flips
 *  rows that are genuinely status='earned' commissions. */
export async function markCommissionsEligible(admin: any, actorId: string, ledgerIds: unknown): Promise<Result<{ count: number }>> {
  if (!Array.isArray(ledgerIds) || ledgerIds.length === 0 || ledgerIds.length > 200 || !ledgerIds.every(isUuid)) return fail("invalid_input", 400);
  const ids = Array.from(new Set(ledgerIds as string[]));
  const { data, error } = await admin.rpc("ambassador_mark_commission_eligible", { p_ledger_ids: ids, p_actor_user_id: actorId });
  if (error) {
    console.error("ambassador_mark_commission_eligible failed:", error.message);
    return fail("failed", 500);
  }
  return { ok: true, count: Number(data ?? 0) };
}

// ------------------------------------------------------------ Fapshi send

export async function sendPayoutViaFapshi(admin: any, actorId: string, payoutId: string): Promise<Result<{ transId: string | null }>> {
  if (!isUuid(payoutId)) return fail("invalid_input", 400);
  // The destination snapshot is read HERE, server-side, and only used to call Fapshi.
  const { data: payout } = await admin.from("ambassador_payouts").select(PAYOUT_COLUMNS).eq("id", payoutId).maybeSingle();
  if (!payout) return fail("not_found", 404);
  if (payout.status !== "requested") return fail("not_claimable", 409);
  if (payout.currency !== "XAF") return fail("wrong_currency", 400);
  if (payout.payout_method !== "mobile_money") return fail("wrong_method", 400);
  const details = payout.payout_details as { provider?: string; phone?: string } | null;
  if (!details?.phone || !["mtn", "orange"].includes(details.provider || "")) return fail("bad_destination", 400);
  const amount = Number(payout.amount);
  // Fapshi disburses whole XAF; rounding would pay a different amount than the
  // ledger says, so a fractional total must be settled manually.
  if (!Number.isInteger(amount)) return fail("non_integer_amount", 400);
  if (amount < fapshiMinDisbursementXaf()) return fail("amount_too_small", 400);

  // Claim BEFORE calling Fapshi — the database lets exactly one caller through.
  const claim = await rpc(admin, "ambassador_claim_payout", { p_payout_id: payoutId, p_actor_user_id: actorId });
  if (!claim.ok) return claim.refused;
  const disbursementKey: string = claim.data.disbursement_key;

  const markUncertain = async (reason: string) => {
    const r = await admin.rpc("ambassador_mark_payout_uncertain", { p_payout_id: payoutId, p_actor_user_id: actorId, p_reason: reason });
    if (r.error || !r.data?.ok) console.error(`payout ${payoutId}: could not mark uncertain (${r.error?.message || r.data?.reason})`);
  };

  let transId: string | null = null;
  try {
    const result = await fapshiPayout({
      amount,
      phone: details.phone,
      medium: details.provider === "orange" ? "orange money" : "mobile money",
      userId: payout.recipient_user_id,
      externalId: disbursementKey,
      message: "Ringo Connect — ambassador commission payout",
    });
    transId = result?.transId ?? null;
  } catch (err: any) {
    const { kind, reason } = classifyFapshiPayoutError(err);
    if (kind === "uncertain") {
      // The request may have been executed: hold it. NOT released, NOT re-sent.
      console.error(`ambassador payout ${payoutId}: Fapshi outcome UNCERTAIN (${reason}) — held for reconciliation`);
      await markUncertain(`Fapshi outcome uncertain (${reason})`);
      return fail("fapshi_ambiguous", 502);
    }
    // definitive rejection or never sent: nothing left the account.
    console.error(`ambassador payout ${payoutId}: Fapshi ${kind} (${reason})`);
    const released = await admin.rpc("ambassador_release_payout_claim", { p_payout_id: payoutId, p_actor_user_id: actorId, p_reason: `Fapshi ${kind} (${reason})` });
    if (released.error || !released.data?.ok) console.error(`payout ${payoutId}: claim release failed — left in processing`);
    return fail("fapshi_rejected", 502);
  }

  if (!transId) {
    // Accepted, but nothing to track it by: unknown, never released.
    await markUncertain("Fapshi accepted the payout but returned no transaction id");
    await audit(admin, actorId, "payout_fapshi_no_transaction_id", payoutId, { amount, disbursement_key: disbursementKey }, "Fapshi accepted the payout but returned no transaction id");
    return fail("fapshi_ambiguous", 502);
  }

  const recorded = await admin.rpc("ambassador_record_disbursement_accepted", { p_payout_id: payoutId, p_fapshi_trans_id: transId, p_actor_user_id: actorId });
  if (recorded.error || !recorded.data?.ok) {
    // Money moved but we couldn't store the id: the id is preserved in the
    // audit trail and the payout is held for a human to resolve with it.
    console.error(`payout ${payoutId}: Fapshi accepted ${transId} but it could not be recorded (${recorded.error?.message || recorded.data?.reason})`);
    await audit(admin, actorId, "payout_fapshi_accepted_not_recorded", payoutId, { fapshi_trans_id: transId, amount }, "Fapshi accepted; recording failed — resolve with this transaction id");
    await markUncertain("Fapshi accepted the payout but the transaction id could not be recorded");
    return fail("fapshi_ambiguous", 502);
  }

  await audit(admin, actorId, "payout_sent_fapshi", payoutId, { fapshi_trans_id: transId, amount, disbursement_key: disbursementKey }, null);
  await notifyPayoutStatus(admin, payoutId, "processing");
  return { ok: true, transId };
}

// ------------------------------------------------------------ Fapshi check

export async function checkPayoutFapshi(admin: any, actorId: string | null, payoutId: string): Promise<Result<{ fapshiStatus: string }>> {
  if (!isUuid(payoutId)) return fail("invalid_input", 400);
  const { data: payout } = await admin.from("ambassador_payouts").select(PAYOUT_COLUMNS).eq("id", payoutId).maybeSingle();
  if (!payout) return fail("not_found", 404);
  if (!["processing", "reconciliation_required"].includes(payout.status) || !payout.fapshi_trans_id) return fail("not_in_flight", 409);

  let tx: any;
  try {
    tx = await fapshiGetStatus(payout.fapshi_trans_id, { disbursement: true });
  } catch (err: any) {
    // A failed STATUS CHECK proves nothing either way: change nothing.
    console.error(`ambassador payout ${payoutId}: status check failed:`, err?.message);
    return fail("failed", 502);
  }

  if (tx.status === "SUCCESSFUL") {
    // Authorization inside SQL: an admin, or the system with the SAME transaction id that is stored on the payout.
    const done = await admin.rpc("ambassador_process_payout", { p_payout_id: payoutId, p_fapshi_trans_id: payout.fapshi_trans_id, p_actor_user_id: actorId });
    if (done.error) {
      console.error("ambassador_process_payout failed:", done.error.message);
      return fail("failed", 500);
    }
    if (done.data?.reason === "already_paid") return { ok: true, fapshiStatus: "SUCCESSFUL" }; // replay: nothing new, nothing to announce
    if (!done.data?.ok) return refusal(done.data?.reason);
    await audit(admin, actorId, "payout_confirmed_paid", payoutId, { fapshi_trans_id: payout.fapshi_trans_id }, null);
    await notifyPayoutStatus(admin, payoutId, "paid");
    return { ok: true, fapshiStatus: "SUCCESSFUL" };
  }

  if (tx.status === "FAILED" || tx.status === "EXPIRED") {
    // Fapshi ITSELF says this transaction did not happen: the same payout becomes retryable.
    const reason = `Fapshi disbursement ${String(tx.status).toLowerCase()}${tx.reason ? `: ${String(tx.reason).slice(0, 200)}` : ""} — eligible to retry.`;
    const failed = await admin.rpc("ambassador_fail_disbursement", { p_payout_id: payoutId, p_actor_user_id: actorId, p_reason: reason });
    if (failed.error) {
      console.error("ambassador_fail_disbursement failed:", failed.error.message);
      return fail("failed", 500);
    }
    if (failed.data?.ok) await notifyPayoutStatus(admin, payoutId, "failed");
    return { ok: true, fapshiStatus: String(tx.status) };
  }

  return { ok: true, fapshiStatus: String(tx.status) }; // still in flight
}

// ------------------------------------------------------------ manual paid

/** Settled outside Fapshi (bank transfer, cash). Uses the SAME claim, so it can
 *  never overlap a Fapshi disbursement. */
export async function markPayoutPaidManually(admin: any, actorId: string, payoutId: string, note: unknown): Promise<Result> {
  if (!isUuid(payoutId)) return fail("invalid_input", 400);
  const cleanNote = typeof note === "string" ? note.trim().slice(0, 500) : "";
  if (cleanNote.length < 3) return fail("invalid_input", 400);

  const claim = await rpc(admin, "ambassador_claim_payout", { p_payout_id: payoutId, p_actor_user_id: actorId });
  if (!claim.ok) return claim.refused;

  const done = await admin.rpc("ambassador_process_payout", { p_payout_id: payoutId, p_fapshi_trans_id: null, p_actor_user_id: actorId });
  if (done.error || !done.data?.ok) {
    console.error("ambassador_process_payout (manual) failed:", done.error?.message || done.data?.reason);
    // Nothing was paid: hand the claim back so the payout isn't stranded.
    await admin.rpc("ambassador_release_payout_claim", { p_payout_id: payoutId, p_actor_user_id: actorId, p_reason: "manual settlement did not complete" });
    return done.error ? fail("failed", 500) : refusal(done.data?.reason);
  }
  await audit(admin, actorId, "payout_marked_paid_manually", payoutId, {}, cleanNote);
  await notifyPayoutStatus(admin, payoutId, "paid");
  return { ok: true };
}

// ------------------------------------------------------------ reject

/** Management declines a requested payout; its commissions return to the ordinary eligible balance. */
export async function rejectPayout(admin: any, actorId: string, payoutId: string, reason: unknown): Promise<Result> {
  if (!isUuid(payoutId)) return fail("invalid_input", 400);
  const clean = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  if (clean.length < 3) return fail("invalid_input", 400);
  const r = await rpc(admin, "ambassador_reject_payout", { p_payout_id: payoutId, p_actor_user_id: actorId, p_reason: clean });
  if (!r.ok) return r.refused;
  await notifyPayoutStatus(admin, payoutId, "rejected");
  return { ok: true };
}

// ------------------------------------------------------------ resolve uncertain

/** An admin's explicit decision about an UNCERTAIN payout, after checking
 *  Fapshi's own dashboard. 'sent' requires the Fapshi transaction id; both
 *  require a note; the database audits it. */
export async function resolveUncertainPayout(admin: any, actorId: string, payoutId: string, input: { outcome: unknown; note: unknown; fapshiTransId?: unknown }): Promise<Result<{ outcome: string }>> {
  if (!isUuid(payoutId)) return fail("invalid_input", 400);
  const outcome = input.outcome === "sent" || input.outcome === "not_sent" ? input.outcome : null;
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
  const transId = typeof input.fapshiTransId === "string" ? input.fapshiTransId.trim().slice(0, 100) : "";
  if (!outcome || note.length < 3) return fail("invalid_input", 400);

  const r = await rpc(admin, "ambassador_resolve_uncertain_payout", { p_payout_id: payoutId, p_actor_user_id: actorId, p_outcome: outcome, p_fapshi_trans_id: transId || null, p_note: note });
  if (!r.ok) return r.refused;
  if (outcome === "sent") await notifyPayoutStatus(admin, payoutId, "paid");
  return { ok: true, outcome };
}

// ------------------------------------------------------------ reversal

/** The database is the only authority: it locks the row before deciding, and
 *  refuses a commission that is paid-in-flight or attached to an active payout
 *  (reported as payout_in_flight). */
export async function reverseCommission(admin: any, actorId: string, ledgerId: string, reason: unknown): Promise<Result<{ recoveryLedgerId: string | null }>> {
  if (!isUuid(ledgerId)) return fail("invalid_input", 400);
  const cleanReason = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  if (cleanReason.length < 3) return fail("invalid_input", 400);

  const { data, error } = await admin.rpc("ambassador_reverse_commission", { p_ledger_id: ledgerId, p_actor_user_id: actorId, p_reason: cleanReason });
  if (error) {
    console.error("ambassador_reverse_commission failed:", error.message);
    return fail("failed", 500);
  }
  if (!data?.ok) return refusal(data?.reason);

  // A replay reports already_reversed:true — that must not notify again.
  if (!data.already_reversed) await notifyCommissionReversed(admin, ledgerId);
  return { ok: true, recoveryLedgerId: data.recovery_ledger_id ?? null };
}
