import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { profileHasCategory } from "@/lib/categories";

// Shared by every /dashboard/music/* page — mirrors requireRestaurantProfile
// exactly (see restaurantAuth.ts). Every music_orders/music_customers row
// is scoped by profile_id and RLS-protected the same way (owner or admin
// only), so this is just a UX redirect, not itself a security boundary —
// the real one is the database.
export async function requireMusicProfile() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
  if (!profile) redirect("/auth/login?error=profile_missing");
  if (!profileHasCategory(profile, "music_entertainment")) redirect("/dashboard");

  return { supabase, user, profile };
}
