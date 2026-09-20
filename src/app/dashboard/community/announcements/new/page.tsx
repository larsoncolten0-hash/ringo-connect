import { requireOwnProfile } from "@/lib/community/auth";
import CommunityAnnouncementComposer from "@/components/dashboard/CommunityAnnouncementComposer";

export const dynamic = "force-dynamic";

export default async function CommunityAnnouncementComposerPage({ searchParams }: { searchParams: { id?: string; link?: string; title?: string; image?: string } }) {
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

  // A "Share to community" button on an item passes its link, name and photo. Only http(s)
  // links are accepted; everything is length-limited and stays editable in the composer.
  const safeUrl = (v?: string) => (v && v.length <= 2000 && /^https?:\/\//i.test(v) ? v : undefined);
  const prefill = !announcement
    ? {
        link: safeUrl(searchParams.link),
        title: searchParams.title?.slice(0, 200),
        image: safeUrl(searchParams.image),
      }
    : null;

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
      prefill={prefill}
    />
  );
}
