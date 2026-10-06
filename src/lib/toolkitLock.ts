import { createClient, createAdminClient } from "@/lib/supabase/server";
import { decideBookkeepingAccess, categoryHasInventory } from "@/lib/bookkeeping/decision";

// The Free-plan view of the paid business tools (Record Sale, Inventory, Invoices, Bookkeeping, Reports).
//
// The tools themselves are unchanged and still gated exactly as before (owner, entitled category, not a demo, plans.business_toolkit_enabled;
// re-checked by every API route and database function). This file only answers one extra question, for the dashboard menu and the tool pages:
// "is this owner in an entitled category, but on a plan WITHOUT the toolkit?" If so, the tool is shown locked, with an upgrade call to action,
// instead of being hidden. It reads no business data and never grants access: a locked page renders no tool content and the API still denies.
// An unreadable plan (query error, flag column missing) is NOT treated as locked: nothing is shown that could not be used.

export type ToolkitLock = {
  /** The owner is entitled by category but their plan does not include the business tools. */
  locked: boolean;
  /** Same, and the category also has stock tracking (Inventory is Business & E-commerce only). */
  inventoryLocked: boolean;
};

const OPEN: ToolkitLock = { locked: false, inventoryLocked: false };

type LockProfile = { id: string; user_id: string | null; category?: string | null; categories?: string[] | null; is_demo?: boolean | null };

/** Pure: the lock state from the facts. `planEnabled === false` (a definite "no"), never null/undefined, is what locks. */
export function decideToolkitLock(f: { userId: string | null; profile: LockProfile | null; planEnabled: boolean | null | undefined }): ToolkitLock {
  if (f.planEnabled !== false) return OPEN;
  // everything except the plan flag must already pass: owner of the profile, entitled category, not a demo
  const pre = decideBookkeepingAccess({ userId: f.userId, profile: f.profile, planEnabled: true });
  if (!pre.ok) return OPEN;
  return { locked: true, inventoryLocked: categoryHasInventory(f.profile) };
}

async function readPlanFlag(userId: string): Promise<boolean | null> {
  const { data: row } = await createAdminClient().from("users").select("plans(business_toolkit_enabled)").eq("id", userId).maybeSingle();
  const v = (row as any)?.plans?.business_toolkit_enabled;
  return typeof v === "boolean" ? v : null;
}

/** For the dashboard menu: the signed-in person's OWN profile (the caller already has both). */
export async function toolkitLockForNav(args: { userId: string; profile: LockProfile | null }): Promise<ToolkitLock> {
  try {
    if (!args.profile) return OPEN;
    // cheap pre-check first: everyone outside an entitled category costs no database call
    if (!decideBookkeepingAccess({ userId: args.userId, profile: args.profile, planEnabled: true }).ok) return OPEN;
    return decideToolkitLock({ userId: args.userId, profile: args.profile, planEnabled: await readPlanFlag(args.userId) });
  } catch {
    return OPEN;
  }
}

/** For the tool pages' server layouts: resolves the signed-in person and their own profile itself. */
export async function resolveToolkitLock(): Promise<ToolkitLock> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return OPEN;
    const { data: profile } = await supabase.from("profiles").select("id, user_id, category, categories, is_demo").eq("user_id", user.id).maybeSingle();
    return await toolkitLockForNav({ userId: user.id, profile: profile as LockProfile | null });
  } catch {
    return OPEN;
  }
}
