import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// Shared by every /dashboard/bookings/* page. Unlike requireRestaurantProfile/
// a music equivalent, bookings has no category gate — every profile can turn
// bookings on regardless of category (see BookingButton/BookingPage) — so
// this only resolves the logged-in creator's own profile.
export async function requireOwnProfile() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
  if (!profile) redirect("/auth/login?error=profile_missing");

  return { supabase, user, profile };
}
