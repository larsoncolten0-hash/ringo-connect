import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { profileHasCategory } from "@/lib/categories";

// Shared by every /dashboard/music/* page — mirrors requireRestaurantProfile
// exactly (see restaurantAuth.ts). Every music_orders/music_customers row
// is scoped by profile_id and RLS-protected the same way (owner or admin
// only), so this is just a UX redirect, not itself a security boundary —
// the real one is the database.
//
// KNOWN GAP (not fixed here — flagged, real scope of its own): unlike
// requireRestaurantProfile, this only ever resolves the caller's OWN
// profile — no concept of "the organization I'm currently viewing as
// staff." Same issue and same reasoning as requireOwnProfile in
// src/lib/bookingAuth.ts (see that comment); DashboardShell hides the
// Music/Tickets nav items for staff for exactly this reason.
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
