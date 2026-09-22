import { createAdminClient } from "@/lib/supabase/server";

// The ONLY service-role reads in Ringo AI's context layer. These tables
// have no anon/authenticated RLS policies at all (customer_connections is
// service-role-only by design — see 2026-10-17_ringo_customers_core.sql;
// the loyalty_* tables likewise), so the session client can't count them.
// Each helper is deliberately narrow: one fixed table, a COUNT only (no
// rows, no customer identities), always filtered by the profile id the
// caller passes — which must be the server-resolved AiWorkspace.profileId.
// Returns null on failure so callers can say "couldn't verify" instead of
// reporting a false zero.

export async function countActiveConnections(profileId: string): Promise<number | null> {
  const { count, error } = await createAdminClient()
    .from("customer_connections")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("status", "active");
  if (error) {
    console.error("ai countActiveConnections failed:", error.message);
    return null;
  }
  return count || 0;
}

export async function countConnectionsSince(profileId: string, sinceIso: string): Promise<number | null> {
  const { count, error } = await createAdminClient()
    .from("customer_connections")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("status", "active")
    .gte("connected_at", sinceIso);
  if (error) {
    console.error("ai countConnectionsSince failed:", error.message);
    return null;
  }
  return count || 0;
}

export async function countActiveLoyaltyPrograms(profileId: string): Promise<number | null> {
  const { count, error } = await createAdminClient()
    .from("loyalty_programs")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("active", true);
  if (error) {
    console.error("ai countActiveLoyaltyPrograms failed:", error.message);
    return null;
  }
  return count || 0;
}
