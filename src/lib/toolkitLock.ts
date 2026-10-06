import { createClient, createAdminClient } from "@/lib/supabase/server";
import { decideBookkeepingAccess, categoryHasInventory } from "@/lib/bookkeeping/decision";
import { profileHasCategory } from "@/lib/categories";

// The discoverable view of the business tools (Record Sale, Inventory, Invoices, Bookkeeping, Reports) for an owner who cannot use them.
//
// The tools themselves are unchanged and still gated exactly as before (owner, entitled category, not a demo, plans.business_toolkit_enabled;
// re-checked by every API route and database function). This file only answers extra questions, for the dashboard menu and the tool pages, so the tools
// are SHOWN, locked, instead of hidden:
//   * `locked`       an entitled category on a plan WITHOUT the toolkit: the screen offers an upgrade (it would unlock the tool).
//   * `unavailable`  a category the toolkit is not offered for (Restaurant, Music, Events, Other): the screen says so honestly and points to what that
//                    business has instead. It never offers an upgrade, because upgrading would not unlock anything.
//   * `inventoryUnavailable`  an entitled category without stock tracking (Inventory is Business & E-commerce only): the same honest screen.
// It reads no business data and never grants access: a locked page renders no tool content and the API still denies.
// An unreadable plan (query error, flag column missing) is NOT treated as locked: nothing is shown that could not be used.

export type ToolkitUnavailable = "restaurant" | "music" | "events" | "other";

export type ToolkitLock = {
  /** The owner is entitled by category but their plan does not include the business tools. */
  locked: boolean;
  /** Same, and the category also has stock tracking (Inventory is Business & E-commerce only). */
  inventoryLocked: boolean;
  /** The toolkit is not offered for this profile's category (and which kind of business it is, for the wording and the next step). */
  unavailable: ToolkitUnavailable | null;
  /** Stock tracking is not offered for this profile's category (the other tools may be). */
  inventoryUnavailable: boolean;
};

const OPEN: ToolkitLock = { locked: false, inventoryLocked: false, unavailable: null, inventoryUnavailable: false };

type LockProfile = { id: string; user_id: string | null; category?: string | null; categories?: string[] | null; is_demo?: boolean | null };

function unavailableKind(profile: LockProfile | null): ToolkitUnavailable {
  if (profileHasCategory(profile as any, "restaurant_food")) return "restaurant";
  if (profileHasCategory(profile as any, "music_entertainment")) return "music";
  if (profileHasCategory(profile as any, "events_experiences")) return "events";
  return "other";
}

/** Pure: the lock state from the facts. `planEnabled === false` (a definite "no"), never null/undefined, is what locks by plan. */
export function decideToolkitLock(f: { userId: string | null; profile: LockProfile | null; planEnabled: boolean | null | undefined }): ToolkitLock {
  // Everything except the plan is decided by the same rule the backend uses, with the plan assumed present: owner of the profile, not a demo, entitled category.
  const base = decideBookkeepingAccess({ userId: f.userId, profile: f.profile, planEnabled: true });
  if (!base.ok) {
    // The one refusal that is about the CATEGORY (every earlier check passed): the tools are shown as not available for this kind of business.
    if (base.reason === "category_not_enabled") return { ...OPEN, unavailable: unavailableKind(f.profile), inventoryUnavailable: true };
    return OPEN; // a visitor, a non-owner or a demo account sees no tool menu at all
  }
  const inventoryUnavailable = !categoryHasInventory(f.profile);
  if (f.planEnabled === false) return { locked: true, inventoryLocked: !inventoryUnavailable, unavailable: null, inventoryUnavailable };
  return { ...OPEN, inventoryUnavailable };
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
    // A category-decided answer needs no database call at all; only an entitled owner costs one read, for the plan flag.
    const pre = decideBookkeepingAccess({ userId: args.userId, profile: args.profile, planEnabled: true });
    if (!pre.ok) return decideToolkitLock({ userId: args.userId, profile: args.profile, planEnabled: null });
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
