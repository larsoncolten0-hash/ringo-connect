import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveBookkeepingOwner } from "@/lib/bookkeeping/access";
import { decideBookkeepingAccess } from "@/lib/bookkeeping/decision";

// Page-level and navigation access for the invoice area. It is exactly the bookkeeping gate (owner of the profile, Business &
// E-commerce category, plan flag, not a demo): the same server-side rules the API routes and the database functions re-check.
// Pages and the nav entry are UX; the API and the database are the real boundaries.

/** For /dashboard/documents/** server layouts and pages: redirect anyone who is not entitled. */
export async function requireDocumentsOwner() {
  const access = await resolveBookkeepingOwner();
  if (!access.ok) redirect(access.reason === "not_signed_in" ? "/auth/login" : "/dashboard");
  return access.owner;
}

/**
 * Whether to show the "Invoices" entry in the dashboard navigation. True only when the account's own profile is entitled AND the
 * Phase 2 tables exist. Before the migration (or on any error) the entry is simply hidden: nobody sees a half-working section.
 * Everyone outside the entitled category costs no database call.
 */
export async function documentsNavVisible(args: {
  userId: string;
  profile: { id: string; user_id: string | null; category?: string | null; categories?: string[] | null; is_demo?: boolean | null } | null;
}): Promise<boolean> {
  try {
    if (!args.profile) return false;
    const pre = decideBookkeepingAccess({ userId: args.userId, profile: args.profile, planEnabled: true });
    if (!pre.ok) return false;
    const admin = createAdminClient();
    const { data: row } = await admin.from("users").select("plans(business_toolkit_enabled)").eq("id", args.userId).maybeSingle();
    if ((row as any)?.plans?.business_toolkit_enabled !== true) return false;
    const { error } = await admin.from("bk_documents").select("id", { head: true, count: "exact" }).eq("profile_id", args.profile.id).limit(1);
    return !error;
  } catch {
    return false;
  }
}
