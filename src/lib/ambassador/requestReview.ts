// Ambassadors and Team Leaders approving THEIR OWN clients' new accounts.
//
// This extends the existing "super creator" review capability (an admin grants
// users.can_approve_requests to a person — the same per-person switch, in the
// same Admin -> Users screen) with a second way a granted reviewer can be
// allowed to act on a signup request: the request is one of THEIR Ambassador
// Program clients. Everything is derived server-side from ambassador_sales,
// which the approved SQL functions write when a signup is attributed:
//   * an Ambassador  -> requests whose sale belongs to that Ambassador;
//   * a Team Leader  -> requests whose sale carries THEIR team (the team
//     recorded on the sale at signup time — so an Ambassador who later moves
//     teams never moves their old clients with them), which covers every
//     Ambassador on the team and the Team Leader's own sales as an Ambassador.
// Only ACTIVE Ambassadors and teams count: a suspended or inactive one has no scope.
//
// These reviewers are deliberately narrower than a full admin or a legacy
// super creator (see validateAmbassadorApproval): they can approve ONLY a
// request whose ONLINE payment Fapshi has already confirmed, only for the plan
// and interval the client actually asked and paid for, and never with the
// "already paid in cash/transfer" route. They cannot reject, delete or charge —
// those routes remain admin-only and are not touched by this file.
import { canReviewerAccessRequest, type RequestReviewer } from "@/lib/assertAdmin";

export interface ReviewerScope {
  ambassadorId: string | null;
  teamId: string | null;
}

export type RequestAccess = "admin" | "affiliate" | "ambassador";

const SCOPE_LIST_LIMIT = 1000;

/** The reviewer's Ambassador Program scope, active roles only. */
export async function getReviewerScope(admin: any, userId: string): Promise<ReviewerScope> {
  const [{ data: ambassador }, { data: team }] = await Promise.all([
    admin.from("ambassador_profiles").select("id, status").eq("user_id", userId).maybeSingle(),
    admin.from("ambassador_teams").select("id, status").eq("team_leader_user_id", userId).maybeSingle(),
  ]);
  return {
    ambassadorId: ambassador && ambassador.status === "active" ? ambassador.id : null,
    teamId: team && team.status === "active" ? team.id : null,
  };
}

/** Signup request ids inside the scope (bounded, most recent sales first). */
export async function scopedSignupRequestIds(admin: any, scope: ReviewerScope, limit = SCOPE_LIST_LIMIT): Promise<string[]> {
  const ids = new Set<string>();
  const add = (rows: any[] | null) => {
    for (const r of rows || []) if (r.signup_request_id) ids.add(r.signup_request_id);
  };
  if (scope.ambassadorId) {
    const { data } = await admin.from("ambassador_sales").select("signup_request_id").eq("ambassador_id", scope.ambassadorId).order("attributed_at", { ascending: false }).limit(limit);
    add(data);
  }
  if (scope.teamId) {
    const { data } = await admin.from("ambassador_sales").select("signup_request_id").eq("team_id", scope.teamId).order("attributed_at", { ascending: false }).limit(limit);
    add(data);
  }
  return Array.from(ids);
}

/** Is this one signup request inside the scope? */
export async function requestInScope(admin: any, scope: ReviewerScope, signupRequestId: string): Promise<boolean> {
  if (!scope.ambassadorId && !scope.teamId) return false;
  const { data: sale } = await admin.from("ambassador_sales").select("ambassador_id, team_id").eq("signup_request_id", signupRequestId).maybeSingle();
  if (!sale) return false;
  return (!!scope.ambassadorId && sale.ambassador_id === scope.ambassadorId) || (!!scope.teamId && !!sale.team_id && sale.team_id === scope.teamId);
}

/** How (if at all) this reviewer may act on this request. Order matters: a full
 *  admin first, then the legacy affiliate-code scope (unchanged behaviour), then
 *  the Ambassador Program scope. null = no access (callers answer 404). */
export async function resolveRequestAccess(admin: any, reviewer: RequestReviewer, signupRequest: { id: string; referral_code: string | null }): Promise<RequestAccess | null> {
  if (reviewer.isAdmin) return "admin";
  if (canReviewerAccessRequest(reviewer, signupRequest.referral_code)) return "affiliate";
  const scope = await getReviewerScope(admin, reviewer.id);
  return (await requestInScope(admin, scope, signupRequest.id)) ? "ambassador" : null;
}

export type ApprovalRefusalCode = "online_payment_required" | "plan_locked" | "email_locked" | "payment_method_locked";

/** The extra rules for access === "ambassador". Pure — the caller still runs the
 *  approve route's own Fapshi re-verification of pending_fapshi_trans_id
 *  (paymentMethod "charge" does exactly that before creating anything). */
export function validateAmbassadorApproval(
  signupRequest: { customer_paid?: boolean | null; pending_fapshi_trans_id?: string | null; requested_plan_id?: string | null; requested_interval?: string | null; email?: string | null },
  body: { planId?: unknown; billingInterval?: unknown; paymentMethod?: unknown; email?: unknown }
): { ok: true } | { ok: false; code: ApprovalRefusalCode; error: string } {
  // 1. Only requests whose ONLINE payment is confirmed. customer_paid is set only by the
  //    pay-status route after Fapshi itself reports SUCCESSFUL.
  if (signupRequest.customer_paid !== true || !signupRequest.pending_fapshi_trans_id) {
    return { ok: false, code: "online_payment_required", error: "This request can be approved only after the client's online payment is confirmed." };
  }
  // 2. Never the cash/transfer route, and never skipping payment: the online payment is
  //    recorded through the same verified "charge" branch an admin's approval uses.
  if (body.paymentMethod !== "charge") {
    return { ok: false, code: "payment_method_locked", error: "Only confirmed online payments can be approved from here." };
  }
  // 3. The plan/interval the client asked for and paid for — never a different one.
  const interval = signupRequest.requested_interval === "yearly" ? "yearly" : "monthly";
  const bodyInterval = body.billingInterval === "yearly" ? "yearly" : "monthly";
  if (!signupRequest.requested_plan_id || body.planId !== signupRequest.requested_plan_id || bodyInterval !== interval) {
    return { ok: false, code: "plan_locked", error: "The plan must match what the client requested and paid for." };
  }
  // 4. The account is created for the email the client registered with.
  if (typeof body.email !== "string" || body.email.trim().toLowerCase() !== String(signupRequest.email || "").trim().toLowerCase()) {
    return { ok: false, code: "email_locked", error: "The account email must match the client's registration." };
  }
  return { ok: true };
}

/** Pending signup requests inside the reviewer's Ambassador Program scope (for the dashboard card). */
export async function pendingScopedRequestCount(admin: any, userId: string): Promise<number> {
  const ids = await scopedSignupRequestIds(admin, await getReviewerScope(admin, userId));
  if (ids.length === 0) return 0;
  const { count } = await admin.from("signup_requests").select("id", { count: "exact", head: true }).eq("status", "pending").in("id", ids);
  return count ?? 0;
}
