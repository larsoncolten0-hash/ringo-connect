import { createAdminClient } from "@/lib/supabase/server";

// Typed wrappers around the Loyalty security-definer database functions
// (supabase/migrations/2026-10-21_ringo_loyalty.sql). Those functions are INTERNAL
// TRUSTED PRIMITIVES: they never authenticate anyone. A route must have ALREADY
//   1. authenticated the business user,
//   2. resolved the active profile server-side,
//   3. checked the loyalty.* permission (see access.ts),
//   4. resolved the customer through a QR scan or a profile-scoped connection id
//      (see customers.ts) and verified the active connection,
// before calling anything here. Every id passed in below therefore comes from the
// SERVER's own resolution, never from a request body. (The functions re-check that
// the program/reward/package belongs to the profile and that the connection is active
// as defence in depth, but that is a backstop, not the gate.)
//
// The service-role client is the only role allowed to execute these functions, and
// it has no direct write access to the ledger, memberships, rewards or packages.

export type LoyaltyAdmin = ReturnType<typeof createAdminClient>;

export type NotifyMilestone = "near_2" | "near_1" | "unlocked" | "redeemed";
export type ActivitySource = "staff_scan" | "staff_search";

export class LoyaltyRpcError extends Error {
  constructor(fn: string, message: string) {
    super(`${fn} failed: ${message}`);
    this.name = "LoyaltyRpcError";
  }
}

async function call(admin: LoyaltyAdmin, fn: string, args: Record<string, unknown>): Promise<any> {
  const { data, error } = await admin.rpc(fn as any, args as any);
  if (error) throw new LoyaltyRpcError(fn, error.message);
  return data;
}

function firstRow(fn: string, data: any): any {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new LoyaltyRpcError(fn, "no result row");
  return row;
}

// ---------------------------------------------------------------------
// Record activity
// ---------------------------------------------------------------------

export type RecordOutcome =
  | "recorded"
  | "duplicate"
  | "at_target"
  | "not_connected"
  | "program_inactive"
  | "program_not_found"
  | "invalid_request"
  | "invalid_quantity"
  | "quantity_too_large"
  | "exceeds_remaining";

export interface RecordResult {
  outcome: RecordOutcome;
  activityId: string | null;
  membershipId: string | null;
  progress: number | null;
  target: number | null;
  cycle: number | null;
  rewardId: string | null;
  notify: NotifyMilestone[];
}

export async function recordActivity(
  input: {
    profileId: string;
    customerId: string;
    programId: string;
    quantity: number;
    staffUserId: string;
    source: ActivitySource;
    idempotencyKey: string;
    refKind?: "music_order" | "restaurant_order" | "booking" | "ticket_order" | "payment" | null;
    refId?: string | null;
  },
  admin: LoyaltyAdmin = createAdminClient()
): Promise<RecordResult> {
  const row = firstRow(
    "loyalty_record_activity",
    await call(admin, "loyalty_record_activity", {
      p_profile_id: input.profileId,
      p_customer_id: input.customerId,
      p_program_id: input.programId,
      p_quantity: input.quantity,
      p_staff_user_id: input.staffUserId,
      p_source: input.source,
      p_idempotency_key: input.idempotencyKey,
      p_ref_kind: input.refKind ?? null,
      p_ref_id: input.refId ?? null,
    })
  );
  return {
    outcome: row.out_outcome,
    activityId: row.out_activity_id ?? null,
    membershipId: row.out_membership_id ?? null,
    progress: row.out_progress ?? null,
    target: row.out_target ?? null,
    cycle: row.out_cycle ?? null,
    rewardId: row.out_reward_id ?? null,
    notify: (row.out_notify ?? []) as NotifyMilestone[],
  };
}

// ---------------------------------------------------------------------
// Redeem a reward
// ---------------------------------------------------------------------

export type RedeemOutcome = "redeemed" | "already_redeemed" | "expired" | "voided" | "not_found" | "not_connected";

export interface RedeemResult {
  outcome: RedeemOutcome;
  rewardId: string | null;
  membershipId: string | null;
  customerId: string | null;
  title: string | null;
  progress: number | null;
  cycle: number | null;
  notify: NotifyMilestone[];
}

export async function redeemReward(
  input: { profileId: string; rewardId: string; staffUserId: string },
  admin: LoyaltyAdmin = createAdminClient()
): Promise<RedeemResult> {
  const row = firstRow(
    "loyalty_redeem_reward",
    await call(admin, "loyalty_redeem_reward", {
      p_profile_id: input.profileId,
      p_reward_id: input.rewardId,
      p_staff_user_id: input.staffUserId,
    })
  );
  return {
    outcome: row.out_outcome,
    rewardId: row.out_reward_id ?? null,
    membershipId: row.out_membership_id ?? null,
    customerId: row.out_customer_id ?? null,
    title: row.out_title ?? null,
    progress: row.out_progress ?? null,
    cycle: row.out_cycle ?? null,
    notify: (row.out_notify ?? []) as NotifyMilestone[],
  };
}

// ---------------------------------------------------------------------
// Reverse an activity (compensating row; reason is mandatory)
// ---------------------------------------------------------------------

export type ReverseOutcome = "reversed" | "duplicate" | "already_reversed" | "not_reversible" | "not_found" | "invalid_request";

export interface ReverseResult {
  outcome: ReverseOutcome;
  reversalId: string | null;
  customerId: string | null;
  balance: number | null;
}

export async function reverseActivity(
  input: { profileId: string; activityId: string; staffUserId: string; reason: string; idempotencyKey: string },
  admin: LoyaltyAdmin = createAdminClient()
): Promise<ReverseResult> {
  const row = firstRow(
    "loyalty_reverse_activity",
    await call(admin, "loyalty_reverse_activity", {
      p_profile_id: input.profileId,
      p_activity_id: input.activityId,
      p_staff_user_id: input.staffUserId,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
    })
  );
  return {
    outcome: row.out_outcome,
    reversalId: row.out_reversal_id ?? null,
    customerId: row.out_customer_id ?? null,
    balance: row.out_balance ?? null,
  };
}

// ---------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------

export type ActivateOutcome =
  | "activated"
  | "duplicate"
  | "template_not_found"
  | "template_inactive"
  | "not_connected"
  | "invalid_request";

export async function activatePackage(
  input: {
    profileId: string;
    customerId: string;
    templateId: string;
    startsAt: Date | null;
    staffUserId: string;
    paymentReference: string | null;
    activationKey: string;
  },
  admin: LoyaltyAdmin = createAdminClient()
): Promise<{ outcome: ActivateOutcome; packageId: string | null }> {
  const row = firstRow(
    "loyalty_activate_package",
    await call(admin, "loyalty_activate_package", {
      p_profile_id: input.profileId,
      p_customer_id: input.customerId,
      p_template_id: input.templateId,
      p_starts_at: input.startsAt ? input.startsAt.toISOString() : null,
      p_staff_user_id: input.staffUserId,
      p_payment_reference: input.paymentReference,
      p_activation_key: input.activationKey,
    })
  );
  return { outcome: row.out_outcome, packageId: row.out_package_id ?? null };
}

export type UseCreditOutcome =
  | "recorded"
  | "duplicate"
  | "not_found"
  | "not_connected"
  | "package_cancelled"
  | "package_expired"
  | "package_not_started"
  | "insufficient_balance"
  | "invalid_request";

export interface UseCreditResult {
  outcome: UseCreditOutcome;
  activityId: string | null;
  packageId: string | null;
  packageStatus: string | null;
  actionKey: string | null;
  remaining: number | null;
}

export async function usePackageCredit(
  input: {
    profileId: string;
    customerId: string;
    creditId: string;
    quantity: number;
    staffUserId: string;
    source: ActivitySource;
    idempotencyKey: string;
  },
  admin: LoyaltyAdmin = createAdminClient()
): Promise<UseCreditResult> {
  const row = firstRow(
    "loyalty_use_package_credit",
    await call(admin, "loyalty_use_package_credit", {
      p_profile_id: input.profileId,
      p_customer_id: input.customerId,
      p_credit_id: input.creditId,
      p_quantity: input.quantity,
      p_staff_user_id: input.staffUserId,
      p_source: input.source,
      p_idempotency_key: input.idempotencyKey,
    })
  );
  return {
    outcome: row.out_outcome,
    activityId: row.out_activity_id ?? null,
    packageId: row.out_package_id ?? null,
    packageStatus: row.out_package_status ?? null,
    actionKey: row.out_action_key ?? null,
    remaining: row.out_remaining ?? null,
  };
}

export type CancelOutcome = "cancelled" | "not_cancellable" | "invalid_request";

export async function cancelPackage(
  input: { profileId: string; packageId: string; staffUserId: string },
  admin: LoyaltyAdmin = createAdminClient()
): Promise<CancelOutcome> {
  const data = await call(admin, "loyalty_cancel_package", {
    p_profile_id: input.profileId,
    p_package_id: input.packageId,
    p_staff_user_id: input.staffUserId,
  });
  return data as CancelOutcome;
}

// ---------------------------------------------------------------------
// Cron: packages expiring soon. Each package is returned by exactly ONE call
// (the claim is a unique insert), so the caller may notify for every row returned.
// ---------------------------------------------------------------------

export interface ExpiringPackage {
  packageId: string;
  customerId: string;
  profileId: string;
  name: string;
  endsAt: string;
}

export async function claimExpiringPackages(
  withinDays = 5,
  admin: LoyaltyAdmin = createAdminClient()
): Promise<ExpiringPackage[]> {
  const data = await call(admin, "loyalty_claim_expiring_packages", { p_within_days: withinDays });
  return ((data ?? []) as any[]).map((r) => ({
    packageId: r.out_package_id,
    customerId: r.out_customer_id,
    profileId: r.out_profile_id,
    name: r.out_name,
    endsAt: r.out_ends_at,
  }));
}

// ---------------------------------------------------------------------
// Scheduled expiry maintenance (loyalty_sweep_expired). The database commits the state changes
// (expired rewards closed, ended packages marked expired) and CLAIMS each notification in
// loyalty_expiry_log; it returns only the events THIS call newly claimed for customers who are
// still connected. Delivery is the caller's job, afterwards, and can never undo the state.
// ---------------------------------------------------------------------

export type ExpiryEventKind = "reward_expiring" | "reward_expired" | "package_expired";

export interface ExpiryEvent {
  event: ExpiryEventKind;
  customerId: string;
  profileId: string;
  subjectId: string;
  title: string; // reward title or package name
  at: string; // when it expires / expired
  remaining: number | null; // unused package credits (packages only)
}

export async function sweepExpired(
  options: { limit?: number; warnDays?: number } = {},
  admin: LoyaltyAdmin = createAdminClient()
): Promise<ExpiryEvent[]> {
  const data = await call(admin, "loyalty_sweep_expired", { p_limit: options.limit ?? 200, p_warn_days: options.warnDays ?? 3 });
  return ((data ?? []) as any[]).map((r) => ({
    event: r.out_event,
    customerId: r.out_customer_id,
    profileId: r.out_profile_id,
    subjectId: r.out_subject_id,
    title: r.out_title,
    at: r.out_at,
    remaining: r.out_remaining ?? null,
  }));
}

// ---------------------------------------------------------------------
// Outcome -> HTTP status, shared by every route so the same outcome always maps to
// the same status. Success and idempotent replays are 200; "you cannot do that right
// now" states are 409; unknown / cross-profile ids are 404 (never revealing which);
// malformed input is 400.
// ---------------------------------------------------------------------

const OK = new Set(["recorded", "redeemed", "reversed", "activated", "cancelled", "duplicate"]);
const NOT_FOUND = new Set(["not_found", "program_not_found", "template_not_found"]);
const BAD_REQUEST = new Set(["invalid_request", "invalid_quantity", "quantity_too_large", "exceeds_remaining"]);

export function outcomeHttpStatus(outcome: string): number {
  if (OK.has(outcome)) return 200;
  if (NOT_FOUND.has(outcome)) return 404;
  if (BAD_REQUEST.has(outcome)) return 400;
  return 409;
}
