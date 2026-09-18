import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { profileHasCategory, profileHasTicketing } from "@/lib/categories";
import { getBrandingSettings } from "@/lib/branding";
import { listUserOrganizations, pickActiveOrganization } from "@/lib/team/access";
import { getAssociationNavAccess } from "@/lib/association/access";
import { getSubscriptionReminderSettings, getSubscriptionBannerState } from "@/lib/subscriptionReminderSettings";

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
    .select("email, role, can_approve_requests, plan_expires_at, payment_provider, plans(name), onboarding_completed_at, onboarding_dismissed_at")
    .eq("id", user.id)
    .single();

  // The "active organization" (see src/lib/team/access.ts) drives every
  // category/branding decision below — it's the user's own profile when
  // they own one (unchanged from before Team & Organization Management
  // existed), or whichever organization they're an active staff member of
  // and have switched into otherwise. A brand-new account always has its
  // own profile (the signup trigger creates one), so `orgs` is only ever
  // empty in a genuinely broken account state.
  const [orgs, branding, reminderSettings] = await Promise.all([
    listUserOrganizations(user.id),
    getBrandingSettings(),
    getSubscriptionReminderSettings(),
  ]);
  // Persistent "renew soon" banner — the signed-in person's OWN billing
  // state, independent of whichever organization is currently active
  // (staff acting inside someone else's business has nothing to renew
  // here; only an owner's own account ever carries plan_expires_at).
  const subscriptionBanner = getSubscriptionBannerState(
    { planExpiresAt: userRow?.plan_expires_at ?? null, paymentProvider: userRow?.payment_provider ?? null },
    reminderSettings
  );
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
  // plan_expires_at lives on the signed-in person's OWN account — it's
  // meaningless while acting as staff inside someone else's organization
  // (there's nothing of theirs to renew from that context), so the banner
  // only ever shows for an owner looking at their own account/business.
  const visibleSubscriptionBanner = isActingAsStaff ? null : subscriptionBanner;
  // Team nav only ever shows for an Enterprise-plan organization (see
  // 2026-10-02_team_plan_gate.sql) — a Personal-plan owner never sees it,
  // even though they're the owner, and hiding it here is only the UX
  // half: /dashboard/team's own layout and every /api/team/* route
  // enforce the exact same two conditions server-side.
  const canManageTeam = !!active && active.teamEnabled && (active.isOwner || active.permissions.includes("staff.view"));
  // Association Program — entirely independent of Team's active-organization
  // concept (an Association Owner is just the normal profile owner; a
  // Partner is a totally separate relationship — see the migration's own
  // header). Always resolved against the signed-in person's OWN profile,
  // never whichever organization Team has switched into.
  const canManageAssociation = ownProfile ? await getAssociationNavAccess(user.id, ownProfile.id) : false;

  // Onboarding tour — gated on the signed-in person's own account state
  // (never completed AND never dismissed), and never shown while acting as
  // staff inside someone else's organization: the tour is about setting up
  // YOUR OWN page, which has nothing to do with whichever business's
  // workspace is currently active. Same "staff never sees this" reasoning
  // as visibleSubscriptionBanner above.
  const showOnboardingTour = !isActingAsStaff && !userRow?.onboarding_completed_at && !userRow?.onboarding_dismissed_at;

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
      canManageAssociation={canManageAssociation}
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
      subscriptionBanner={visibleSubscriptionBanner}
      isDemo={!!ownProfile?.is_demo}
      showOnboardingTour={showOnboardingTour}
      onboardingProfile={
        showOnboardingTour && ownProfile
          ? {
              category: ownProfile.category,
              categories: ownProfile.categories,
              community_enabled: ownProfile.community_enabled,
              bookings_enabled: ownProfile.bookings_enabled,
            }
          : null
      }
    >
      {children}
    </DashboardShell>
  );
}
