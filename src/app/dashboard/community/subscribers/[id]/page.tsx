import { notFound } from "next/navigation";
import { requireOwnProfile } from "@/lib/community/auth";
import CommunitySubscriberDetail from "@/components/dashboard/CommunitySubscriberDetail";

export const dynamic = "force-dynamic";

export default async function CommunitySubscriberDetailPage({ params }: { params: { id: string } }) {
  const { supabase, profile } = await requireOwnProfile();

  const { data: subscriber } = await supabase
    .from("community_subscribers")
    .select("*, community_subscription_preferences(*)")
    .eq("id", params.id)
    .eq("profile_id", profile.id)
    .single();

  if (!subscriber) return notFound();

  return <CommunitySubscriberDetail subscriber={subscriber} />;
}
