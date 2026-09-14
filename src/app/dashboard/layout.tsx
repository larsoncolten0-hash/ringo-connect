import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { profileHasCategory, profileHasTicketing } from "@/lib/categories";
import { getBrandingSettings } from "@/lib/branding";
import { listUserOrganizations, pickActiveOrganization } from "@/lib/team/access";

// Per-creator PWA installability (manifest link, iOS home-screen name/
// icon, theme color) for the whole /dashboard/** tree — see
// src/lib/dashboardMetadata.ts.
export { generateMetadata, generateViewport } from "@/lib/dashboardMetadata";

// See src/app/admin/settings/page.tsx for why this matters — this layout
// is what feeds the sidebar's plan badge, so a stale cache here could
// keep showing "Free" right after an upgrade.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: userRow } = await supabase
    .from("users")
    .select("email, role, can_approve_requests, plans(name)")
    .eq("id", user.id)
    .single();

  // The "active organization" (see src/lib/team/access.ts) drives every
  // category/branding decision below — it's the user's own profile when
  // they own one (unchanged from before Team & Organization Management
  // existed), or whichever organization they're an active staff member of
  // and have switched into otherwise. A brand-new account always has its
  // own profile (the signup trigger creates one), so `orgs` is only ever
  // empty in a genuinely broken account state.
  const [orgs, branding] = await Promise.all([listUserOrganizations(user.id), getBrandingSettings()]);
  const active = pickActiveOrganization(orgs);
  const profile = active?.profile ?? null;
  // The signed-in person's OWN profile, independent of whichever
  // organization is currently active — every account has exactly one (the
  // signup trigger guarantees it), so `orgs` always has an isOwner entry
  // for it regardless of how many other organizations they're staff at.
  // Needed for AvatarMenu's "show my role on my profile" toggle below: that
  // preference belongs to the person, not to whichever business's
  // workspace they happen to be viewing right now.
  const ownProfile = orgs.find((o) => o.isOwner)?.profile ?? null;

  const planName = (userRow?.plans as any)?.name ?? "free";
  // Acting inside someone else's organization (not the owner) — this is
  // what DashboardShell uses to show the "which business am I working for"
  // banner (see the product spec's "WHO AM I? WHICH BUSINESS?" section).
  // An owner never sees it: for them there's no ambiguity, the business IS
  // their own account.
  const isActingAsStaff = !!active && !active.isOwner;
  // Team nav only ever shows for an Enterprise-plan organization (see
  // 2026-10-02_team_plan_gate.sql) — a Personal-plan owner never sees it,
  // even though they're the owner, and hiding it here is only the UX
  // half: /dashboard/team's own layout and every /api/team/* route
  // enforce the exact same two conditions server-side.
  const canManageTeam = !!active && active.teamEnabled && (active.isOwner || active.permissions.includes("staff.view"));

  return (
    <DashboardShell
      userId={user.id}
      email={userRow?.email ?? user.email ?? ""}
      username={profile?.username ?? "you"}
      avatarUrl={profile?.avatar_url}
      planName={planName}
      isFreePlan={planName === "free"}
      isVerified={!!profile?.verified}
      canApproveRequests={userRow?.role === "admin" || !!userRow?.can_approve_requests}
      isRestaurant={profileHasCategory(profile, "restaurant_food")}
      isMusic={profileHasCategory(profile, "music_entertainment")}
      hasTicketing={profileHasTicketing(profile)}
      canManageTeam={canManageTeam}
      organization={
        active
          ? {
              profileId: active.profile.id,
              name: active.profile.name || active.profile.username,
              roleName: active.roleName,
              isStaff: isActingAsStaff,
            }
          : null
      }
      organizations={orgs.map((o) => ({
        profileId: o.profile.id,
        name: o.profile.name || o.profile.username,
        isOwner: o.isOwner,
        roleName: o.roleName,
        // An owned profile that isn't itself an Enterprise business reads
        // as "Personal" in the switcher (see the product spec's own
        // example: "Personal Ringo → Personal") rather than showing its
        // profile name — it's just the person's individual account, not a
        // business workspace they manage a team for.
        teamEnabled: o.teamEnabled,
      }))}
      appName={branding.appName}
      logoUrl={branding.logoUrl}
      ownProfileId={ownProfile?.id ?? null}
      teamBadgesEnabled={ownProfile?.team_badges_enabled ?? true}
    >
      {children}
    </DashboardShell>
  );
}
