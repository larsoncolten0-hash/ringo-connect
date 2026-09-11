import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { profileHasCategory } from "@/lib/categories";
import MusicStorePage from "@/components/music/MusicStorePage";

// See src/app/[username]/page.tsx's own comment.
export { generateMetadata, generateViewport } from "@/lib/profileMetadata";

// The dedicated "Buy Now" commerce page — reachable from the public
// profile's Buy Now button. Mirrors /r/[username]'s architecture (a
// dedicated storefront + cart + checkout page) for the same reason: a
// full commerce flow doesn't fit inside the single-page profile.
export const dynamic = "force-dynamic";

export default async function MusicStoreRoute({ params }: { params: { username: string } }) {
  const supabase = createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select(`*, tracks(*), music_releases(*), products(*), events(*)`)
    .eq("username", params.username)
    .eq("published", true)
    .single();

  if (!profile || !profileHasCategory(profile, "music_entertainment")) return notFound();

  return <MusicStorePage profile={profile} />;
}
