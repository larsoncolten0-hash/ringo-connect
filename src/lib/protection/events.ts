import type { ProtectionActor, ProtectionStatus } from "./types";

// Writes one row to the append-only protection_transaction_events log (see
// 2026-11-07_ringo_protection_transitions.sql for why this exists as its own table, separate from
// protection_ledger_entries). Never financial — see engine.ts, which never touches the ledger.
//
// `admin` is loosely typed (any Supabase client) so engine.ts can be tested against an in-memory
// fake without importing Supabase — same reasoning productCheckout's CheckoutStore interface uses.
type Admin = any;

const UNIQUE_VIOLATION = "23505";

export interface RecordEventInput {
  protectionTransactionId: string;
  fromStatus: ProtectionStatus;
  toStatus: ProtectionStatus;
  actor: ProtectionActor;
  reason?: string | null;
  idempotencyKey?: string | null;
}

/**
 * Best-effort by design past the point the transition itself already succeeded: the transition's
 * own conditional UPDATE (engine.ts) is what actually claims the state change atomically. This
 * insert is the durable audit trail for it — a duplicate insert (same idempotencyKey, e.g. a
 * retried request landing here twice) is swallowed as "already recorded," never surfaced as a
 * failure of the transition itself, which already happened.
 */
export async function recordProtectionTransactionEvent(admin: Admin, input: RecordEventInput): Promise<void> {
  const row: Record<string, unknown> = {
    protection_transaction_id: input.protectionTransactionId,
    from_status: input.fromStatus,
    to_status: input.toStatus,
    actor_type: input.actor.type,
    actor_user_id: input.actor.type === "seller" || input.actor.type === "admin" ? input.actor.userId : null,
    actor_customer_id: input.actor.type === "customer" ? input.actor.customerId : null,
    reason: input.reason ?? null,
    idempotency_key: input.idempotencyKey ?? null,
  };

  const { error } = await admin.from("protection_transaction_events").insert(row);
  if (error && error.code !== UNIQUE_VIOLATION) {
    // Logged, not thrown: the state transition already succeeded and must not be reported as
    // failed just because its audit row couldn't be written.
    console.error("protection_transaction_events insert failed:", error.message || error.code);
  }
}
