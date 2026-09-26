import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { profileHasTicketing } from "@/lib/categories";
import { splitByPlanLimit } from "@/lib/planEntitlements";
import MusicStorePage from "@/components/music/MusicStorePage";

// See src/app/[username]/page.tsx's own comment.
export { generateMetadata, generateViewport } from "@/lib/profileMetadata";

// The dedicated "Buy Now" commerce page — reachable from the public
// profile's Buy Now button. Mirrors /r/[username]'s architecture (a
// dedicated storefront + cart + checkout page) for the same reason: a
// full commerce flow doesn't fit inside the single-page profile. Shared by
// Music & Entertainment and Events & Experiences (see
// profileHasTicketing) — an events-only profile with no tracks/releases
// just never renders those sections, the same way a music profile with no
// merch never renders the merch grid.
export const dynamic = "force-dynamic";

export default async function MusicStoreRoute({ params }: { params: { username: string } }) {
  const supabase = createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select(`*, tracks(*), music_releases(*), products(*), events(*, event_ticket_types(*)), users!user_id(plans(max_products))`)
    .eq("username", params.username)
    .eq("published", true)
    .single();

  if (!profile || !profileHasTicketing(profile)) return notFound();

  // Same plan-based visibility limit as the main profile page (see
  // planEntitlements.ts) — this storefront reads from the same `products`
  // table, so it must never show more than the creator's current plan allows
  // just because a visitor reached it through a different URL.
  const { users: ownerUsersRow, ...storeProfile } = profile as any;
  const { visible: visibleProducts } = splitByPlanLimit(profile.products || [], ownerUsersRow?.plans?.max_products ?? null);
  storeProfile.products = visibleProducts;

  return <MusicStorePage profile={storeProfile} />;
}
