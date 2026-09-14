import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { profileHasCategory } from "@/lib/categories";
import { resolveActiveOrganization } from "@/lib/team/access";
import type { Permission } from "@/lib/team/permissions";

// Shared by every /dashboard/restaurant/* page — resolves the *active*
// organization for the logged-in user (their own restaurant if they own
// one, or an organization they're an active team member of — see
// resolveActiveOrganization) and bounces back to the main editor if that
// organization hasn't picked Restaurant & Food, or if a specific
// `permission` is required and the caller doesn't hold it.
//
// Every restaurant table's RLS also enforces this independently (owner/
// admin, or a permitted staff member — see 2026-10-01_team_management.sql),
// so this remains a UX redirect layered on top of a real security boundary,
// not the only thing standing between a page and its data — the same
// relationship this function always had with the database, just now
// extended to staff as well as owners.
export async function requireRestaurantProfile(permission?: Permission) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const active = await resolveActiveOrganization(user.id);
  if (!active) redirect("/auth/login?error=profile_missing");
  if (!profileHasCategory(active.profile, "restaurant_food")) redirect("/dashboard");

  if (permission && !active.isOwner && !active.permissions.includes(permission)) {
    redirect("/dashboard/restaurant");
  }

  return {
    supabase,
    user,
    profile: active.profile,
    // Exposed so pages/components can adapt copy or hide actions a
    // permitted-but-not-full-access staff member shouldn't see, beyond the
    // hard page-level gate above (e.g. RestaurantOrdersView hiding the
    // "Mark Ready" button for someone with orders.view but not
    // orders.update).
    access: { isOwner: active.isOwner, roleName: active.roleName, permissions: active.permissions },
  };
}
