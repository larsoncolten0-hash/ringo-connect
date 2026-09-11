import { requireOwnProfile } from "@/lib/community/auth";
import CommunityAnnouncementComposer from "@/components/dashboard/CommunityAnnouncementComposer";

export const dynamic = "force-dynamic";

export default async function CommunityAnnouncementComposerPage({ searchParams }: { searchParams: { id?: string } }) {
  const { supabase, user, profile } = await requireOwnProfile();

  let announcement = null;
  if (searchParams.id) {
    const { data } = await supabase
      .from("community_announcements")
      .select("*")
      .eq("id", searchParams.id)
      .eq("profile_id", profile.id)
      .single();
    announcement = data;
  }

  const [{ data: products }, { data: tracks }, { data: events }] = await Promise.all([
    supabase.from("products").select("id, name").eq("profile_id", profile.id).order("sort_order"),
    supabase.from("tracks").select("id, title").eq("profile_id", profile.id).order("sort_order"),
    supabase.from("events").select("id, title").eq("profile_id", profile.id).order("sort_order"),
  ]);

  return (
    <CommunityAnnouncementComposer
      profileId={profile.id}
      userId={user.id}
      announcement={announcement}
      products={products || []}
      tracks={tracks || []}
      events={events || []}
    />
  );
}
