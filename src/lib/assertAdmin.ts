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

/**
 * Verifies the current request is from either a full admin OR a "super
 * creator" — a regular creator an admin has separately granted
 * can_approve_requests to (see the matching migration). Used only by the
 * signup-request review routes (approve/reject/charge/delete) — nothing
 * else should accept this weaker check, since a super creator has no
 * other admin capability. Returns the authenticated user, or null.
 */
export async function assertCanApproveRequests() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from("users")
    .select("role, can_approve_requests")
    .eq("id", user.id)
    .single();
  if (userRow?.role !== "admin" && !userRow?.can_approve_requests) return null;

  return user;
}