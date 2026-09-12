import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CommunityJoinPage from "@/components/CommunityJoinPage";

// The dedicated "Join Community" surface — reached from the public
// profile's Stay Connected section (see ProfileView.tsx). Its own route
// rather than an on-page modal, the same reasoning /[username]/book
// already uses.
export const dynamic = "force-dynamic";

export default async function CommunityJoinRoute({ params }: { params: { username: string } }) {
  const supabase = createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, name, category, theme_color, community_enabled, community_label")
    .eq("username", params.username)
    .eq("published", true)
    .single();

  if (!profile || !profile.community_enabled) return notFound();

  return <CommunityJoinPage profile={profile} />;
}
