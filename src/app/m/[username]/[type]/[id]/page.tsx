import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { profileHasCategory } from "@/lib/categories";
import ItemDetailPage from "@/components/music/ItemDetailPage";

// See src/app/[username]/page.tsx's own comment.
export { generateMetadata, generateViewport } from "@/lib/profileMetadata";

// One detail page shared by all four sellable item kinds — a song, an
// EP/Album, a merch item, or a ticket — reached by tapping the
// corresponding card on the public profile (see MusicSection,
// ReleasesSection, EventsSection, and the Catalog grid in ProfileView.tsx,
// all of which now link here instead of buying/redirecting immediately).
// Exists so a fan sees more about what they're about to buy — full
// artwork, a description, an EP/Album's actual tracklist — before the
// real purchase, which still only ever happens on the storefront at
// /m/[username] (see the `add=<type>:<id>` query param it reads).
//
// A single `[type]/[id]` route rather than four separate ones: all four
// share the exact same profile fetch and 404 handling, and only differ in
// which array of the same profile they look the item up in.
export const dynamic = "force-dynamic";

const VALID_TYPES = ["track", "release", "merch", "ticket"] as const;
type ItemType = (typeof VALID_TYPES)[number];

export default async function ItemDetailRoute({
  params,
}: {
  params: { username: string; type: string; id: string };
}) {
  if (!VALID_TYPES.includes(params.type as ItemType)) return notFound();
  const type = params.type as ItemType;

  const supabase = createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select(`*, tracks(*), music_releases(*), products(*), events(*, event_ticket_types(*))`)
    .eq("username", params.username)
    .eq("published", true)
    .single();

  if (!profile || !profileHasCategory(profile, "music_entertainment")) return notFound();

  const item =
    type === "track"
      ? (profile.tracks || []).find((t: any) => t.id === params.id)
      : type === "release"
      ? (profile.music_releases || []).find((r: any) => r.id === params.id)
      : type === "merch"
      ? (profile.products || []).find((p: any) => p.id === params.id)
      : // A draft event isn't reachable here either — same as it being
        // hidden from every other public listing (see MusicStorePage's
        // own `tickets` filter).
        (profile.events || []).find((e: any) => e.id === params.id && e.status !== "draft");

  if (!item) return notFound();

  return <ItemDetailPage profile={profile} type={type} item={item} />;
}
