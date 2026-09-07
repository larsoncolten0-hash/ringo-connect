import { createClient } from "@/lib/supabase/server";

/**
 * Verifies the current request is from a logged-in admin. Returns the
 * authenticated user (with role confirmed) or null — callers should
 * respond 403 on null. Every admin-only API route should use this exact
 * check rather than reimplementing it, so there's exactly one place that
 * defines "what counts as an admin."
 */
export async function assertAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase.from("users").select("role").eq("id", user.id).single();
  if (userRow?.role !== "admin") return null;

  return user;
}

export type RequestReviewer = {
  id: string;
  isAdmin: boolean;
  // Every user row gets one via a DB trigger the moment it's created (see
  // 2026-09-06_affiliate_system.sql) — null here only means that
  // migration hasn't run. A super creator is scoped to requests whose
  // `referral_code` matches THIS exactly; a full admin isn't scoped at
  // all. Callers must apply that filter themselves — this function only
  // answers "is this person allowed to review requests at all."
  affiliateCode: string | null;
};

/**
 * Verifies the current request is from either a full admin OR a "super
 * creator" — a regular creator an admin has separately granted
 * can_approve_requests to (see the matching migration). Used only by the
 * signup-request approve/charge/charge-status routes — nothing else
 * should accept this weaker check, since a super creator has no other
 * admin capability. Deliberately excludes reject and delete — those stay
 * assertAdmin-only, see reject/route.ts and delete/route.ts.
 *
 * A super creator is additionally scoped to only the requests that came
 * in through their own affiliate link — every caller of this function
 * MUST filter/verify by `affiliateCode` against the request's
 * `referral_code` itself when `isAdmin` is false; this function can't do
 * that part since it has no specific request in hand.
 */
export async function assertCanApproveRequests(): Promise<RequestReviewer | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from("users")
    .select("role, can_approve_requests, affiliate_code")
    .eq("id", user.id)
    .single();
  const isAdmin = userRow?.role === "admin";
  if (!isAdmin && !userRow?.can_approve_requests) return null;

  return { id: user.id, isAdmin, affiliateCode: userRow?.affiliate_code ?? null };
}

/**
 * True when `reviewer` (a non-null result of assertCanApproveRequests) is
 * allowed to act on this specific signup request — a full admin always
 * is; a super creator only when the request's own referral_code matches
 * the code THEY were assigned. Both sides are already stored
 * upper/trimmed (see attribute_referral() and the signup-requests POST
 * route), so this is a plain equality check, not a fuzzy one.
 */
export function canReviewerAccessRequest(reviewer: RequestReviewer, requestReferralCode: string | null) {
  if (reviewer.isAdmin) return true;
  return !!reviewer.affiliateCode && requestReferralCode === reviewer.affiliateCode;
}