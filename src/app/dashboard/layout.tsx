import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { profileHasCategory, profileHasTicketing } from "@/lib/categories";
import { getBrandingSettings } from "@/lib/branding";

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

  const [{ data: profile }, branding] = await Promise.all([
    supabase.from("profiles").select("username, avatar_url, category, categories, verified").eq("user_id", user.id).single(),
    getBrandingSettings(),
  ]);

  const planName = (userRow?.plans as any)?.name ?? "free";

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
      appName={branding.appName}
      logoUrl={branding.logoUrl}
    >
      {children}
    </DashboardShell>
  );
}