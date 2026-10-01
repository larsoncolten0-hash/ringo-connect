// Access for the Customers area, exactly the Invoices/Inventory/Reports pattern: the owner of a Business & E-commerce profile whose plan has the
// Business Toolkit, never a demo profile (the bookkeeping gate), and the Phase 3 contact table must exist (before that the entry is hidden).
// Pages and the nav entry are UX; the API enforces access itself.
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveBookkeepingOwner } from "@/lib/bookkeeping/access";
import { decideBookkeepingAccess } from "@/lib/bookkeeping/decision";

export async function requireCustomersOwner() {
  const access = await resolveBookkeepingOwner();
  if (!access.ok) redirect(access.reason === "not_signed_in" ? "/auth/login" : "/dashboard");
  return access.owner;
}

export async function customersAvailable(owner: { admin: any; profile: { id: string } }): Promise<boolean> {
  try {
    const { error } = await owner.admin.from("bk_customers").select("id", { head: true, count: "exact" }).eq("profile_id", owner.profile.id).limit(1);
    return !error;
  } catch {
    return false;
  }
}

/** Whether to show "Customers" in the dashboard navigation. Everyone outside the entitled category costs no database call. */
export async function customersNavVisible(args: {
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
    return await customersAvailable({ admin, profile: { id: args.profile.id } });
  } catch {
    return false;
  }
}
