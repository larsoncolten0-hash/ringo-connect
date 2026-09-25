import type { ProtectionActorType, ProtectionStatus } from "./types";

// The single authoritative transition map — pure, dependency-free data. Every legality and
// authorization decision the engine makes derives from THIS table, never duplicated ad hoc
// elsewhere in application code. The database's own protection_transactions_guard trigger
// (2026-11-07_ringo_protection_transitions.sql) independently encodes the same transitions in SQL
// as a defense-in-depth backstop, exactly how product_orders_guard already backstops
// productCheckout's own application-level checks — scripts/tests/protectionTransitions.test.mjs
// statically cross-checks the two stay in sync.
//
// A status with an empty array is terminal: nothing may transition out of it, ever.
interface TransitionRule {
  to: ProtectionStatus;
  /** Which actor types may REQUEST this specific transition. */
  actors: ProtectionActorType[];
}

export const LEGAL_TRANSITIONS: Record<ProtectionStatus, TransitionRule[]> = {
  awaiting_payment: [
    { to: "protected", actors: ["system"] },
    { to: "payment_failed", actors: ["system"] },
    { to: "expired", actors: ["system"] },
    { to: "cancelled", actors: ["system", "customer"] },
  ],
  protected: [
    { to: "fulfillment_started", actors: ["seller"] },
    { to: "cancelled", actors: ["seller", "admin"] },
    { to: "disputed", actors: ["customer"] },
  ],
  fulfillment_started: [
    { to: "awaiting_confirmation", actors: ["seller"] },
    { to: "disputed", actors: ["customer"] },
    { to: "cancelled", actors: ["seller", "admin"] },
  ],
  awaiting_confirmation: [
    { to: "released", actors: ["customer", "system"] },
    { to: "disputed", actors: ["customer"] },
  ],
  disputed: [
    { to: "resolved_release", actors: ["admin"] },
    { to: "resolved_refund", actors: ["admin"] },
  ],
  resolved_release: [{ to: "released", actors: ["system", "admin"] }],
  resolved_refund: [{ to: "refunded", actors: ["system", "admin"] }],
  // Terminal — no outgoing transitions, ever.
  released: [],
  refunded: [],
  cancelled: [],
  expired: [],
  payment_failed: [],
};

export const PROTECTION_STATUSES = Object.keys(LEGAL_TRANSITIONS) as ProtectionStatus[];

export const TERMINAL_STATUSES: ProtectionStatus[] = PROTECTION_STATUSES.filter((s) => LEGAL_TRANSITIONS[s].length === 0);

export function isLegalTransition(from: ProtectionStatus, to: ProtectionStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.some((r) => r.to === to) ?? false;
}

/** Actor types allowed to request this exact (from, to) transition — empty if the transition itself is illegal. */
export function allowedActorsFor(from: ProtectionStatus, to: ProtectionStatus): ProtectionActorType[] {
  return LEGAL_TRANSITIONS[from]?.find((r) => r.to === to)?.actors ?? [];
}

/** Every status that may legally transition INTO `to` — the reverse lookup the engine's
 *  conditional UPDATE's WHERE clause is built from (one atomic statement, no separate lock step
 *  needed: a single-row conditional UPDATE is race-safe by construction under Postgres). */
export function legalFromStatusesFor(to: ProtectionStatus): ProtectionStatus[] {
  return PROTECTION_STATUSES.filter((from) => isLegalTransition(from, to));
}
