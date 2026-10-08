import { isPublicProfileSuspended } from "@/lib/publicProfileVisibility";
import type { Metadata, ResolvingMetadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { memoPerRequest } from "@/lib/requestMemo";
import { notFound } from "next/navigation";
import { profileHasCategory } from "@/lib/categories";
import { generateMetadata as generateProfileMetadata, generateViewport } from "@/lib/profileMetadata";
import { NOINDEX, withItemSeo } from "@/lib/seo";
import ProductDetailView from "@/components/catalog/ProductDetailView";
import { productImages } from "@/components/catalog/productHref";
import { computeCheckoutAvailability } from "@/lib/productCheckout/availability";

export { generateViewport };

// The detail page for a catalog / merch / service item on ANY category's
// public profile (Music & Entertainment's merch keeps its existing
// /m/[username]/merch/[id] URL, which renders the same view). Reached by
// tapping the item's card on the profile — see CatalogSection. Read-only:
// buying/contacting still happens through the creator's own link, the
// storefront checkout (Music), or WhatsApp, exactly as before.
export const dynamic = "force-dynamic";

// Memoised per request: generateMetadata and the page both call it with the same arguments and used to run the same profile + products query twice.
const getItem = memoPerRequest(async function getItem(username: string, id: string) {
  const supabase = createClient();
  // The profile read and the suspension check both start from the username: they run together.
  const [{ data: profile }, suspended] = await Promise.all([
    supabase
      .from("profiles")
      .select("*, products(*)")
      .eq("username", username)
      .eq("published", true)
      .single(),
    isPublicProfileSuspended(username),
  ]);
  if (!profile) return null;
  if (suspended) return null;
  // An item the creator marked unavailable is hidden from the profile, so a
  // direct link to it 404s too (same rule as every other public listing).
  const product = (profile.products || []).find((p: any) => p.id === id && p.available !== false);
  if (!product) return null;
  return { profile, product };
});

// Shares the profile's own metadata (PWA manifest link, theme color…) and
// swaps in the item's name and photo, so a link shared on WhatsApp/social
// previews the actual product.
export async function generateMetadata(
  { params }: { params: { username: string; id: string } },
  parent: ResolvingMetadata
): Promise<Metadata> {
  const found = await getItem(params.username, params.id);
  // An item the page itself would 404 (unavailable, unpublished, suspended) advertises nothing.
  if (!found) return { robots: NOINDEX };
  const base = await generateProfileMetadata({ params }, parent);
  return withItemSeo(base, {
    path: `/${encodeURIComponent(params.username)}/item/${encodeURIComponent(params.id)}`,
    title: `${found.product.name} — ${found.profile.name || found.profile.username}`,
    description: found.product.description,
    image: productImages(found.product)[0],
  });
}

export default async function ProductDetailRoute({ params }: { params: { username: string; id: string } }) {
  const found = await getItem(params.username, params.id);
  if (!found) return notFound();
  const { profile, product } = found;

  const related = (profile.products || [])
    .filter((p: any) => p.id !== product.id && p.available !== false)
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .slice(0, 8);

  // Server-authoritative: does this product qualify for the generic checkout right now? (Cheap pre-checks
  // skip the settings read for music profiles, items with a link and items with no explicit purchase CTA.)
  const checkoutAvailable = await computeCheckoutAvailability(profile, product);

  return (
    <ProductDetailView
      profile={profile}
      product={product}
      related={related}
      isMusic={profileHasCategory(profile, "music_entertainment")}
      checkoutAvailable={checkoutAvailable}
    />
  );
}
