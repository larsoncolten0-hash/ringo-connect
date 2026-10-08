import * as React from "react";
import { createAdminClient } from "@/lib/supabase/server";

// A suspended account's public profile is UNAVAILABLE to view.
//
// Suspension lives on users.status (set from Admin -> Users; it already blocks
// login). Public profile pages are served to logged-out visitors from the
// `profiles` table, which is publicly readable, so nothing about the owner's
// account state reached them before. This is the one place that asks the
// question, used by every public profile route (and its metadata) so the
// answer is the same everywhere and is derived LIVE from users.status:
// suspending hides the profile immediately, un-suspending restores it, and
// nothing about the profile's own data (including its `published` flag)
// is ever modified.
//
// It answers only "is the owner suspended" — a boolean, nothing about why.
// Routes respond with the same 404 an unpublished/nonexistent profile gets, so a
// visitor cannot tell a suspended profile from one that doesn't exist.
//
// Uses the service-role client because `users` is private (no public read).
// Fails OPEN: if the lookup itself errors, the profile is shown and the error
// is logged — a database hiccup must not blank every profile on the platform.

// React's request-scoped cache() is present in the Next.js server runtime; where it
// isn't (plain Node, tests) this degrades to an uncached call.
const memo: <T extends (...args: any[]) => any>(fn: T) => T = (React as any).cache ?? ((fn: any) => fn);

export type PublicOwnerAccount = {
  /** The owner's account is suspended (users.status). Fails OPEN: false when the lookup fails or the profile has no owner. */
  suspended: boolean;
  /** The owner's CURRENT plan limits (max_links, max_products, custom_theme_enabled), or null when unknown. Used only to limit what a public page shows. */
  plan: { max_links?: number | null; max_products?: number | null; custom_theme_enabled?: boolean | null } | null;
};

// ONE round trip for what every public page needs to know about the owner by username: the profile's owner row is embedded (profiles.user_id -> users.id) and carries both the
// account status and the plan (users.plan -> plans). It used to be a profile read, then a users read for the status, then another users read for the plan: three requests in a row.
// Same questions, same answers, same fail-open rule; the service-role client is unchanged (no RLS to fall back on, `users` is private). Memoised per request, so the status check and
// the plan lookup on the same page share one query.
export const getPublicOwnerAccount = memo(async (username: string): Promise<PublicOwnerAccount> => {
  try {
    const admin = createAdminClient();
    const { data: profile, error: lookupError } = await admin
      .from("profiles")
      .select("user_id, users(status, plans(max_links, max_products, custom_theme_enabled))")
      .eq("username", username)
      .maybeSingle();
    if (lookupError) {
      console.error("public profile suspension check failed (owner lookup):", lookupError.message);
      return { suspended: false, plan: null };
    }
    if (!profile?.user_id) return { suspended: false, plan: null };
    const owner: any = Array.isArray((profile as any).users) ? (profile as any).users[0] : (profile as any).users;
    const plan: any = Array.isArray(owner?.plans) ? owner.plans[0] : owner?.plans;
    return { suspended: owner?.status === "suspended", plan: plan ?? null };
  } catch (err: any) {
    console.error("public profile suspension check threw:", err?.message);
    return { suspended: false, plan: null };
  }
});

export const isPublicProfileSuspended = memo(async (username: string): Promise<boolean> => (await getPublicOwnerAccount(username)).suspended);
