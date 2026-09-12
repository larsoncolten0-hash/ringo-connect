import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { profileHasCategory } from "@/lib/categories";

// Shared by every /dashboard/restaurant/* page — resolves the logged-in
// creator's own profile and bounces back to the main editor if they
// haven't actually picked Restaurant & Food. Every restaurant table is
// scoped by profile_id and RLS-protected the same way products/links
// already are (owner or admin only), so this is just a UX redirect, not
// itself a security boundary — the real one is the database.
export async function requireRestaurantProfile() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
  if (!profile) redirect("/auth/login?error=profile_missing");
  if (!profileHasCategory(profile, "restaurant_food")) redirect("/dashboard");

  return { supabase, user, profile };
}
