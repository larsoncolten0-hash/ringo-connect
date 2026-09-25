// Ringo Protection — Phase 2 domain types. Dependency-free: no Supabase, no Next, matching the
// SAME "core logic imports nothing outside the module" discipline productCheckout's own pure
// files already follow (see productCheckout.test.mjs's isolation checks).

export type ProtectionStatus =
  | "awaiting_payment"
  | "protected"
  | "fulfillment_started"
  | "awaiting_confirmation"
  | "released"
  | "disputed"
  | "resolved_release"
  | "resolved_refund"
  | "refunded"
  | "cancelled"
  | "expired"
  | "payment_failed";

// Who may request a transition. The engine resolves this from an already-authenticated caller
// (a signed-in seller/customer session, an assertAdmin() result, or the server itself) — it is
// never inferred from anything the client sends. "system" covers server-internal transitions
// (payment confirmation, cron-driven expiry/auto-release) with no human actor at all.
export type ProtectionActorType = "system" | "seller" | "customer" | "admin";

export type ProtectionActor =
  | { type: "system" }
  | { type: "seller"; userId: string }
  | { type: "customer"; customerId: string }
  | { type: "admin"; userId: string };
