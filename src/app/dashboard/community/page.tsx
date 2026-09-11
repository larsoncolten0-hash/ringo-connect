import { requireOwnProfile } from "@/lib/community/auth";
import CommunityOverview from "@/components/dashboard/CommunityOverview";

export const dynamic = "force-dynamic";

export default async function CommunityOverviewPage() {
  const { supabase, profile } = await requireOwnProfile();

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ count: totalCount }, { count: newCount }, { count: emailCount }, { count: whatsappCount }, { data: recentAnnouncements }] =
    await Promise.all([
      supabase
        .from("community_subscribers")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", profile.id)
        .eq("status", "active"),
      supabase
        .from("community_subscribers")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", profile.id)
        .eq("status", "active")
        .gte("created_at", oneWeekAgo),
      supabase
        .from("community_subscribers")
        .select("id, community_subscription_preferences!inner(email_updates)", { count: "exact", head: true })
        .eq("profile_id", profile.id)
        .eq("status", "active")
        .eq("community_subscription_preferences.email_updates", true),
      supabase
        .from("community_subscribers")
        .select("id, community_subscription_preferences!inner(whatsapp_updates)", { count: "exact", head: true })
        .eq("profile_id", profile.id)
        .eq("status", "active")
        .eq("community_subscription_preferences.whatsapp_updates", true),
      supabase
        .from("community_announcements")
        .select("*")
        .eq("profile_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";

  return (
    <CommunityOverview
      username={profile.username}
      siteUrl={siteUrl}
      totalCount={totalCount ?? 0}
      newCount={newCount ?? 0}
      emailCount={emailCount ?? 0}
      whatsappCount={whatsappCount ?? 0}
      recentAnnouncements={recentAnnouncements || []}
    />
  );
}
