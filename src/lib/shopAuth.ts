import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { profileHasCategory } from "@/lib/categories";

// Access rules for /dashboard/shop/* (Increment 5A) - mirrors requireMusicProfile: OWNER ONLY. It
// resolves the signed-in person's OWN profile and nothing else (no organization/staff switching; the
// dashboard hides the Shop entry for staff for the same reason it hides Music). This is a UX redirect;
// the real boundary is row level security on the four commerce tables plus the profile_id filter every
// query applies.

/** Is the Shop section worth showing? A non-music profile, and either the platform switch is on or the
 *  profile already has orders (so history stays reachable if commerce is switched off later). */
export async function shopIsVisibleFor(supabase: any, profile: { id: string; category?: string | null; categories?: string[] | null } | null): Promise<boolean> {
  if (!profile || profileHasCategory(profile as any, "music_entertainment")) return false;
  try {
    const { data: settings } = await createAdminClient().from("platform_settings").select("commerce_enabled").limit(1).maybeSingle();
    if ((settings as any)?.commerce_enabled === true) return true;
    const { count } = await supabase.from("product_orders").select("id", { count: "exact", head: true }).eq("profile_id", profile.id);
    return (count ?? 0) > 0;
  } catch {
    return false; // never break the whole dashboard over this one nav entry
  }
}

export async function requireShopProfile() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
  if (!profile) redirect("/auth/login?error=profile_missing");
  if (!(await shopIsVisibleFor(supabase, profile))) redirect("/dashboard");

  return { supabase, admin: createAdminClient(), user, profile };
}
