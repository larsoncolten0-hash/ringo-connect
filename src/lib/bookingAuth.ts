import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// Shared by every /dashboard/bookings/* page. Unlike requireRestaurantProfile/
// a music equivalent, bookings has no category gate — every profile can turn
// bookings on regardless of category (see BookingButton/BookingPage) — so
// this only resolves the logged-in creator's own profile.
//
// KNOWN GAP (not fixed here — flagged, real scope of its own): unlike
// requireRestaurantProfile, this is NOT organization-aware — it only ever
// resolves the caller's OWN profile, never "the organization I'm currently
// viewing as staff" (see src/lib/team/access.ts's resolveActiveOrganization).
// For an owner that's harmless (their own profile IS the organization). For
// staff it's actively wrong: they'd silently see their OWN unrelated
// profile's bookings while the org-branding banner says they're working
// inside someone else's business. DashboardShell hides the Bookings nav
// item entirely for staff for exactly this reason — this function itself
// still needs rewriting (mirroring requireRestaurantProfile, plus a real
// staff RLS policy on `bookings` — today it's owner/admin-only) before
// staff could safely use this section at all.
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
