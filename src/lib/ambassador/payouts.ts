// Ambassador Program — Ambassador / Team Leader payout requests and private
// payout destinations.
//
// Everything financial stays in the SQL functions:
//  - ambassador_set_payout_destination() stores the destination in the
//    protected ambassador_payout_destinations table (no PostgREST access at
//    all), stamps the 24-hour cooldown from DATABASE time on a change, and
//    audits it with the masked label only;
//  - ambassador_request_payout() reads that destination itself, refuses one
//    still in its cooldown, enforces platform_settings.ambassador_min_payout_xaf,
//    and selects/locks/sums the eligible ledger rows atomically.
// This module only resolves, from the caller's own session identity, WHO is
// asking and in which role; validates the destination's SHAPE; calls those
// functions; and reads the caller's own figures for display.
//
// PRIVACY: the full destination is never returned by anything in this file.
// The browser receives `maskedLabel` only. The full details are read solely
// inside the admin Fapshi send path, from the payout's own snapshot.
import { notifyPayoutStatus, notifyAdminsOfPayoutRequest, notifyPayoutDestinationChanged } from "@/lib/ambassador/notifications";
import { getAmbassadorPayoutMinimum } from "@/lib/ambassador/settings";

export type PayoutRole = "ambassador" | "team_leader";
export type PayoutMethod = "mobile_money" | "bank";

export type PayoutErrorCode =
  | "invalid_role"
  | "invalid_method"
  | "invalid_details"
  | "not_ambassador"
  | "not_team_leader"
  | "suspended"
  | "demo"
  | "no_destination"
  | "destination_cooling_down"
  | "below_minimum"
  | "nothing_eligible"
  | "unavailable";

export interface PayoutDestination {
  method: PayoutMethod;
  details: Record<string, string>;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Validates the destination's SHAPE. Returns a clean, whitelisted copy — any
 *  extra field a client sends (amount, recipient, ...) is dropped here. */
export function validateDestination(method: unknown, details: unknown): { ok: true; value: PayoutDestination } | { ok: false; code: PayoutErrorCode } {
  const d = (details && typeof details === "object" ? details : {}) as Record<string, unknown>;
  if (method === "mobile_money") {
    const provider = str(d.provider, 10);
    const phone = str(d.phone, 20).replace(/[\s-]/g, "");
    if (!["mtn", "orange"].includes(provider) || !/^\+?\d{8,15}$/.test(phone)) return { ok: false, code: "invalid_details" };
    return { ok: true, value: { method, details: { provider, phone } } };
  }
  if (method === "bank") {
    const accountName = str(d.accountName, 120);
    const accountNumber = str(d.accountNumber, 60);
    const bankName = str(d.bankName, 120);
    if (!accountName || !accountNumber || !bankName) return { ok: false, code: "invalid_details" };
    return { ok: true, value: { method, details: { accountName, accountNumber, bankName } } };
  }
  return { ok: false, code: "invalid_method" };
}

/** Confirms the signed-in user really holds `role`, from authoritative rows. */
export async function resolveRole(admin: any, userId: string, role: unknown): Promise<{ ok: true; role: PayoutRole } | { ok: false; code: PayoutErrorCode }> {
  if (role === "ambassador") {
    const { data } = await admin.from("ambassador_profiles").select("id, status").eq("user_id", userId).maybeSingle();
    if (!data) return { ok: false, code: "not_ambassador" };
    if (data.status === "suspended") return { ok: false, code: "suspended" };
    return { ok: true, role };
  }
  if (role === "team_leader") {
    const { data } = await admin.from("ambassador_teams").select("id").eq("team_leader_user_id", userId).maybeSingle();
    if (!data) return { ok: false, code: "not_team_leader" };
    return { ok: true, role };
  }
  return { ok: false, code: "invalid_role" };
}

const RECIPIENT_REASONS: Record<string, PayoutErrorCode> = {
  not_a_recipient: "unavailable",
  invalid_destination: "invalid_details",
};

// ------------------------------------------------------------- destinations

export interface SavedDestinationResult {
  ok: true;
  maskedLabel: string;
  changed: boolean;
  /** True when this save replaced an existing destination and so started the cooldown. */
  coolingDown: boolean;
  usableAfter: string;
}

export async function saveMyDestination(admin: any, userId: string, input: { role: unknown; method: unknown; details: unknown }): Promise<SavedDestinationResult | { ok: false; code: PayoutErrorCode }> {
  const resolved = await resolveRole(admin, userId, input.role);
  if (!resolved.ok) return resolved;
  const dest = validateDestination(input.method, input.details);
  if (!dest.ok) return dest;

  // Only the whitelisted destination and the session identity reach the database.
  const { data, error } = await admin.rpc("ambassador_set_payout_destination", {
    p_user_id: userId,
    p_recipient_type: resolved.role,
    p_method: dest.value.method,
    p_details: dest.value.details,
    p_actor_user_id: userId,
  });
  if (error) {
    // Never log `details` — the message alone.
    console.error("ambassador_set_payout_destination failed:", error.message);
    return { ok: false, code: "unavailable" };
  }
  if (!data?.ok) return { ok: false, code: RECIPIENT_REASONS[data?.reason] ?? "unavailable" };

  const coolingDown = !!data.changed && !data.first_time;
  // A real CHANGE (not a first save, not an identical re-save) tells the owner.
  if (coolingDown) await notifyPayoutDestinationChanged(admin, userId, resolved.role, String(data.usable_after));
  return { ok: true, maskedLabel: String(data.masked), changed: !!data.changed, coolingDown, usableAfter: String(data.usable_after) };
}

export interface MyDestinationView {
  method: PayoutMethod;
  maskedLabel: string;
  usableAfter: string;
  /** Display only — computed with the server clock. The database decides for real. */
  coolingDown: boolean;
}

/** Explicit column list: `details` is never selected. */
async function getMyDestinationView(admin: any, userId: string, role: PayoutRole): Promise<MyDestinationView | null> {
  const { data } = await admin
    .from("ambassador_payout_destinations")
    .select("method, masked_label, usable_after")
    .eq("user_id", userId)
    .eq("recipient_type", role)
    .maybeSingle();
  if (!data) return null;
  return { method: data.method, maskedLabel: data.masked_label, usableAfter: data.usable_after, coolingDown: new Date(data.usable_after).getTime() > Date.now() };
}

// ----------------------------------------------------------------- requesting

export async function requestMyPayout(
  admin: any,
  userId: string,
  input: { role: unknown }
): Promise<{ ok: true; payoutId: string; amount: number } | { ok: false; code: PayoutErrorCode; minimum?: number; usableAfter?: string }> {
  const resolved = await resolveRole(admin, userId, input.role);
  if (!resolved.ok) return resolved;

  // Demo accounts must never enter a real admin's payout queue.
  const { data: demoProfile } = await admin.from("profiles").select("is_demo").eq("user_id", userId).maybeSingle();
  if (demoProfile?.is_demo) return { ok: false, code: "demo" };

  // Two arguments only: who, and in which role — both server-derived. There is
  // no amount and no destination parameter: SQL sums the eligible rows and
  // reads the owner's private destination itself.
  const { data, error } = await admin.rpc("ambassador_request_payout", {
    p_recipient_type: resolved.role,
    p_recipient_user_id: userId,
  });
  if (error) {
    console.error("ambassador_request_payout failed:", error.message);
    return { ok: false, code: "unavailable" };
  }
  if (!data?.ok) {
    switch (data?.reason) {
      case "nothing_eligible":
        return { ok: false, code: "nothing_eligible" };
      case "no_destination":
        return { ok: false, code: "no_destination" };
      case "destination_cooling_down":
        return { ok: false, code: "destination_cooling_down", usableAfter: data.usable_after };
      case "below_minimum":
        return { ok: false, code: "below_minimum", minimum: Number(data.minimum) };
      default:
        return { ok: false, code: "unavailable" };
    }
  }

  // Notifications never throw and can never undo the payout that now exists.
  await notifyPayoutStatus(admin, data.payout_id, "requested");
  await notifyAdminsOfPayoutRequest(admin, data.payout_id);
  return { ok: true, payoutId: data.payout_id, amount: Number(data.amount) };
}

// --------------------------------------------------------------------- reads

export interface MyPayoutRow {
  id: string;
  amount: number;
  currency: string;
  status: string;
  requestedAt: string;
  processedAt: string | null;
}

export interface MyPayoutOverview {
  role: PayoutRole;
  currency: string;
  /** Earned, waiting for Management to release it for payout. */
  awaitingApproval: number;
  /** Released by Management and not yet attached to a payout — what a request would claim. */
  available: number;
  /** Attached to a payout that is requested/processing/being reconciled. */
  inPayout: number;
  paid: number;
  payouts: MyPayoutRow[];
  /** Masked only — the full destination never leaves the server. */
  destination: MyDestinationView | null;
  /** Display only; the database enforces it. Null when it can't be read. */
  minimumPayout: number | null;
}

/** The caller's OWN figures for one role, resolved from their user id.
 *  Display sums only — the money itself is only ever moved by the SQL functions. */
export async function getMyPayoutOverview(admin: any, userId: string, role: PayoutRole): Promise<MyPayoutOverview> {
  const { data: ledger } = await admin
    .from("ambassador_commission_ledger")
    .select("commission_amount, currency, status, payout_id, entry_type")
    .eq("recipient_user_id", userId)
    .eq("recipient_type", role)
    .eq("entry_type", "commission");
  // Explicit columns: neither the destination snapshot nor Fapshi ids are selected.
  const { data: payoutRows } = await admin
    .from("ambassador_payouts")
    .select("id, amount, currency, status, requested_at, processed_at")
    .eq("recipient_user_id", userId)
    .eq("recipient_type", role)
    .order("requested_at", { ascending: false })
    .limit(50);

  let awaitingApproval = 0;
  let available = 0;
  let inPayout = 0;
  let paid = 0;
  for (const r of ledger || []) {
    const amount = Number(r.commission_amount);
    if (r.status === "earned") awaitingApproval += amount;
    else if (r.status === "eligible_for_payout") (r.payout_id ? (inPayout += amount) : (available += amount));
    else if (r.status === "paid") paid += amount;
  }

  const payouts = (payoutRows || []) as any[];
  return {
    role,
    currency: (ledger && ledger[0]?.currency) || payouts[0]?.currency || "XAF",
    awaitingApproval,
    available,
    inPayout,
    paid,
    // An uncertain disbursement is an internal state; the owner just sees "processing".
    payouts: payouts.map((p) => ({ id: p.id, amount: Number(p.amount), currency: p.currency, status: p.status === "reconciliation_required" ? "processing" : p.status, requestedAt: p.requested_at, processedAt: p.processed_at })),
    destination: await getMyDestinationView(admin, userId, role),
    minimumPayout: await getAmbassadorPayoutMinimum(admin),
  };
}
