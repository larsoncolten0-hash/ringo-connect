import { requireOwnProfile } from "@/lib/community/auth";
import CommunityAnnouncementsList from "@/components/dashboard/CommunityAnnouncementsList";

export const dynamic = "force-dynamic";

export default async function CommunityAnnouncementsPage() {
  const { supabase, profile } = await requireOwnProfile();

  const { data: announcements } = await supabase
    .from("community_announcements")
    .select("*")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false });

  return <CommunityAnnouncementsList announcements={announcements || []} />;
}
