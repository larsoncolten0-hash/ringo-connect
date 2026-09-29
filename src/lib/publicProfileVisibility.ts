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

export const isPublicProfileSuspended = memo(async (username: string): Promise<boolean> => {
  try {
    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin.from("profiles").select("user_id").eq("username", username).maybeSingle();
    if (profileError) {
      console.error("public profile suspension check failed (profile lookup):", profileError.message);
      return false;
    }
    if (!profile?.user_id) return false;
    const { data: owner, error: ownerError } = await admin.from("users").select("status").eq("id", profile.user_id).maybeSingle();
    if (ownerError) {
      console.error("public profile suspension check failed (owner lookup):", ownerError.message);
      return false;
    }
    return owner?.status === "suspended";
  } catch (err: any) {
    console.error("public profile suspension check threw:", err?.message);
    return false;
  }
});
