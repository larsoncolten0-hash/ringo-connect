import { loadMusicDestination } from "@/lib/music/loadDestination";
import MusicDestinationView from "@/components/music/profile/MusicDestinationView";

// See src/app/[username]/page.tsx's own comment.
export { generateMetadata, generateViewport } from "@/lib/profileMetadata";

// The artist's Merch page: a dedicated destination reached from the profile (never a scroll down it). Reads the artist's own rows; every purchase still goes through the existing
// item pages and the single storefront checkout.
export const dynamic = "force-dynamic";

export default async function MusicMerchRoute({ params }: { params: { username: string } }) {
  const profile = await loadMusicDestination(params.username);
  return <MusicDestinationView kind="merch" profile={profile} />;
}
