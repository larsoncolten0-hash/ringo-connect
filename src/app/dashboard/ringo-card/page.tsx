import { headers } from "next/headers";
import { requireOwnProfile } from "@/lib/bookingAuth";
import RingoCardWriter from "@/components/dashboard/RingoCardWriter";
import CardBundleSection from "@/components/dashboard/CardBundleSection";
import { extractRequestContext } from "@/lib/requestContext";

// Ringo Card Writer — connects a physical Ringo Card (an NTAG216 NFC tag)
// to the creator's own Ringo profile URL. See
// src/components/dashboard/RingoCardWriter.tsx for the full flow and
// supabase/migrations/2026-09-23_ringo_cards.sql for the schema.
//
// Reuses requireOwnProfile — the exact same auth/ownership resolution
// every other self-serve dashboard tool (Bookings settings, Community)
// already uses — rather than a bespoke check for this feature.
export const dynamic = "force-dynamic";

export default async function RingoCardWriterPage() {
  const { supabase, user, profile } = await requireOwnProfile();

  // Every Ringo Card this creator has ever assigned/written, most recent
  // first — RLS ("ringo_cards owner all") already scopes this to the
  // caller, the explicit .eq below is belt-and-suspenders. Joined with the
  // connected profile's username/name so the list can show "JAY KAY —
  // ringoconnectltd.com/jaykay" without a second round trip.
  const { data: cards } = await supabase
    .from("ringo_cards")
    .select("*, profiles(username, name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // Card + Subscription bundles — active addon rows that actually grant a
  // plan (see 2026-10-07_card_subscription_bundles.sql). Public read
  // ("addons" has no RLS restricting select), same as get-started's own
  // addon fetch.
  const { data: bundleAddons } = await supabase
    .from("addons")
    .select("id, name, price_xaf, grants_plan_duration_days")
    .eq("active", true)
    .not("grants_plan_name", "is", null)
    .order("sort_order", { ascending: true });

  const { country } = extractRequestContext(headers());

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";

  return (
    <>
      <CardBundleSection bundles={bundleAddons || []} isCameroon={country === "CM"} />
      <RingoCardWriter
        profile={{
          id: profile.id,
          username: profile.username,
          name: profile.name,
          category: profile.category,
          categories: profile.categories,
          about_location: profile.about_location,
          published: profile.published,
        }}
        siteUrl={siteUrl}
        initialCards={cards || []}
      />
    </>
  );
}
