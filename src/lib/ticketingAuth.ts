import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { profileHasTicketing } from "@/lib/categories";

// Shared by every /dashboard/tickets/* page — mirrors requireMusicProfile/
// requireRestaurantProfile exactly, just gated on profileHasTicketing
// instead of a single category: Tickets is its own dashboard section (see
// DashboardShell's nav) reachable by both Music & Entertainment and
// Events & Experiences profiles, the same two categories the public
// ticketing surfaces (EventsSection, the /m/[username] storefront) already
// share. Every events/event_ticket_types/scanner_sessions/
// ticket_checkin_logs row is scoped by profile_id and RLS-protected the
// same way regardless — this is just a UX redirect, not itself the
// security boundary.
export async function requireTicketingProfile() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
  if (!profile) redirect("/auth/login?error=profile_missing");
  if (!profileHasTicketing(profile)) redirect("/dashboard");

  return { supabase, user, profile };
}
