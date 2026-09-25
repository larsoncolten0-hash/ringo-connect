import { allowedActorsFor, legalFromStatusesFor, TERMINAL_STATUSES } from "./transitions";
import { recordProtectionTransactionEvent } from "./events";
import type { ProtectionActor, ProtectionStatus } from "./types";

// The single authoritative place Ringo Protection's lifecycle status is ever changed. Nothing
// else may write protection_transactions.status — mirrors settlement.ts being the one place
// product_orders.status changes, and fulfillOrder.ts being the one place it moves to 'fulfilled'.
//
// Dormant in Phase 2: nothing calls this from a route, a cron, or checkout yet. It exists to be
// unit- and concurrency-tested on its own, and to be the ONE place a later phase wires a real
// trigger (a webhook, a customer confirm button, a cron) into — never a second copy of this logic.
//
// Loosely typed `admin` client (any Supabase client) so this can be exercised against an
// in-memory fake in tests without importing Supabase — same reasoning productCheckout's
// CheckoutStore interface already uses.
type Admin = any;

export type TransitionFailureCode = "not_found" | "illegal_transition" | "already_terminal" | "unauthorized" | "conflict";

export type TransitionOutcome =
  | { ok: true; status: ProtectionStatus; alreadyInStatus: boolean }
  | { ok: false; code: TransitionFailureCode; status: ProtectionStatus | null };

export interface TransitionOptions {
  reason?: string;
  idempotencyKey?: string;
  /** Resolves the auto-release deadline when entering awaiting_confirmation. Injected so the
   *  engine stays dependency-free of platform_settings' own reader (protectionSettings.ts) —
   *  callers pass the current hours value they already have, or omit it to skip setting a
   *  deadline (still schema-valid; a later phase's cron simply has nothing to act on yet). */
  autoReleaseHours?: number;
}

function terminalTimestampPatch(to: ProtectionStatus, now: string): Record<string, unknown> {
  if (to === "protected") return { paid_at: now };
  if (to === "released") return { released_at: now };
  if (to === "refunded") return { refunded_at: now };
  return {};
}

/**
 * Attempts one state transition. Race-safe by construction: a single-row conditional UPDATE
 * (`WHERE id = ? AND status IN (legal predecessors) [AND ownership column = actor]`) is
 * serialized by Postgres's own row locking — no separate SELECT ... FOR UPDATE is needed here,
 * unlike request_commerce_payout()'s multi-row aggregation, because this only ever locks the one
 * row it's updating. Idempotent by construction: calling the same transition twice either finds
 * the row already at the target status (treated as a successful no-op, mirroring
 * fulfillOrder()'s own `already: true` convention) or loses the race to a concurrent identical
 * call and discovers the same thing on re-check — never a duplicate event, never a double
 * transition, never an error for the caller that "lost."
 */
export async function transitionProtectionTransaction(
  admin: Admin,
  id: string,
  to: ProtectionStatus,
  actor: ProtectionActor,
  opts: TransitionOptions = {}
): Promise<TransitionOutcome> {
  const { data: row, error: readError } = await admin
    .from("protection_transactions")
    .select("id, status, creator_user_id, customer_id")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw new Error(`protection_transactions read failed (${readError.code || "error"})`);
  if (!row) return { ok: false, code: "not_found", status: null };

  const currentStatus = row.status as ProtectionStatus;
  if (currentStatus === to) return { ok: true, status: to, alreadyInStatus: true };

  const fromCandidates = legalFromStatusesFor(to);
  if (!fromCandidates.includes(currentStatus)) {
    return { ok: false, code: TERMINAL_STATUSES.includes(currentStatus) ? "already_terminal" : "illegal_transition", status: currentStatus };
  }

  const allowedActors = allowedActorsFor(currentStatus, to);
  if (!allowedActors.includes(actor.type)) {
    return { ok: false, code: "unauthorized", status: currentStatus };
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: to, ...terminalTimestampPatch(to, now) };
  if (to === "awaiting_confirmation" && opts.autoReleaseHours != null) {
    patch.auto_release_at = new Date(Date.now() + opts.autoReleaseHours * 3600_000).toISOString();
  }

  let query = admin.from("protection_transactions").update(patch).eq("id", id).in("status", fromCandidates);
  // Ownership, enforced atomically in the same conditional UPDATE — not a separate app-level
  // check a bug could skip. A seller can only move THEIR OWN transaction; same for a customer.
  if (actor.type === "seller") query = query.eq("creator_user_id", actor.userId);
  if (actor.type === "customer") query = query.eq("customer_id", actor.customerId);

  const { data: updated, error: updateError } = await query.select("id, status");
  if (updateError) throw new Error(`protection_transactions transition failed (${updateError.code || "error"})`);

  if (!updated || updated.length === 0) {
    // Lost a race (another caller already claimed it), an ownership mismatch, or the status moved
    // since our read above — re-check once, the same way settlement.ts re-reads after a lost claim.
    const { data: recheck } = await admin.from("protection_transactions").select("status").eq("id", id).maybeSingle();
    const recheckStatus = (recheck?.status as ProtectionStatus | undefined) ?? null;
    if (recheckStatus === to) return { ok: true, status: to, alreadyInStatus: true };
    return { ok: false, code: "conflict", status: recheckStatus };
  }

  await recordProtectionTransactionEvent(admin, {
    protectionTransactionId: id,
    fromStatus: currentStatus,
    toStatus: to,
    actor,
    reason: opts.reason,
    idempotencyKey: opts.idempotencyKey,
  });

  return { ok: true, status: to, alreadyInStatus: false };
}
