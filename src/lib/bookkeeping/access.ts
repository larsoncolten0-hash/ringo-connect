import { createClient, createAdminClient } from "@/lib/supabase/server";
import { decideBookkeepingAccess, DENIAL_STATUS, type BookkeepingDenial } from "./decision";

export { BOOKKEEPING_CATEGORIES, DENIAL_STATUS, decideBookkeepingAccess } from "./decision";
export type { BookkeepingDenial } from "./decision";

// Access to the Business Toolkit's bookkeeping. FIRST INCREMENT = OWNER ONLY.
//
// Three independent conditions must ALL hold, each decided on the server from the signed-in session:
//   1. the caller owns the profile (profiles.user_id = auth user) — the organization is NEVER taken from
//      the request, so there is nothing for a client to spoof, and organization staff are not admitted;
//   2. the profile is in a category the toolkit is enabled for (code config below);
//   3. the owner's PLAN has plans.business_toolkit_enabled (the existing plan-flag pattern, edited from
//      /admin/plans). Unreadable/missing flag => denied (fails closed).
// The same three are re-checked inside the database RPCs, and the tables' RLS is owner-only, so a bug here
// cannot expose another business's records.
//
// Staff support later: add `bookkeeping.view` / `bookkeeping.manage` to src/lib/team/permissions.ts and
// extend this decision + the RLS/RPC checks in a new migration. Existing sales.view / payments.view /
// reports.view deliberately confer nothing here.

export type BookkeepingOwner = {
  userId: string;
  profile: { id: string; currency: string | null };
  supabase: ReturnType<typeof createClient>;
  admin: ReturnType<typeof createAdminClient>;
};

/** Resolves the caller for a bookkeeping API route. The profile is always the caller's OWN profile. */
export async function resolveBookkeepingOwner(): Promise<{ ok: true; owner: BookkeepingOwner } | { ok: false; reason: BookkeepingDenial }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not_signed_in" };

  const { data: profile } = await supabase.from("profiles").select("id, user_id, category, categories, is_demo, currency").eq("user_id", user.id).maybeSingle();

  const admin = createAdminClient();
  let planEnabled: boolean | null = null;
  if (profile) {
    // Plan of the OWNER, via the same users.plan_id -> plans embed the Team and Ringo AI gates use.
    // An error (e.g. the column does not exist yet) leaves this null => denied.
    const { data: row } = await admin.from("users").select("plans(business_toolkit_enabled)").eq("id", user.id).maybeSingle();
    const v = (row as any)?.plans?.business_toolkit_enabled;
    planEnabled = typeof v === "boolean" ? v : null;
  }

  const decision = decideBookkeepingAccess({ userId: user.id, profile: profile as any, planEnabled });
  if (!decision.ok) return decision;
  return { ok: true, owner: { userId: user.id, profile: { id: (profile as any).id, currency: (profile as any).currency ?? null }, supabase, admin } };
}
