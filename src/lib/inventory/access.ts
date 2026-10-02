// Access for the Inventory area, exactly the Invoices/Debtors pattern: the owner of a Business & E-commerce profile whose plan has the
// Business Toolkit, never a demo profile (the bookkeeping gate), and the Phase 4 tables must exist (before the migration the entry is simply
// hidden, nobody sees a half-working section). Pages and the nav entry are UX; the API and the database functions enforce access themselves.
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveBookkeepingOwner } from "@/lib/bookkeeping/access";
import { categoryHasInventory, decideBookkeepingAccess } from "@/lib/bookkeeping/decision";

export async function requireInventoryOwner() {
  const access = await resolveBookkeepingOwner();
  if (!access.ok) redirect(access.reason === "not_signed_in" ? "/auth/login" : "/dashboard");
  return access.owner;
}

export async function inventoryAvailable(owner: { admin: any; profile: { id: string } }): Promise<boolean> {
  try {
    // Stock tracking is enforced for Business & E-commerce profiles by the database functions themselves (inv_start_tracking raises category_not_enabled for any
    // other category), so the Inventory area is not offered to the other Business Toolkit categories (it would be a half-working section).
    const { data: prof } = await owner.admin.from("profiles").select("category, categories").eq("id", owner.profile.id).maybeSingle();
    if (!categoryHasInventory(prof as any)) return false;
    const { error } = await owner.admin.from("bk_stock_settings").select("product_id", { head: true, count: "exact" }).eq("profile_id", owner.profile.id).limit(1);
    return !error;
  } catch {
    return false;
  }
}

/** Whether to show "Inventory" in the dashboard navigation. Everyone outside the entitled category costs no database call. */
export async function inventoryNavVisible(args: {
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
    return await inventoryAvailable({ admin, profile: { id: args.profile.id } });
  } catch {
    return false;
  }
}
