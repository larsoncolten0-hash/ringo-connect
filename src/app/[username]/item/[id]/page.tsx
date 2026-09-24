import type { Metadata, ResolvingMetadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { profileHasCategory } from "@/lib/categories";
import { generateMetadata as generateProfileMetadata, generateViewport } from "@/lib/profileMetadata";
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

async function getItem(username: string, id: string) {
  const supabase = createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*, products(*)")
    .eq("username", username)
    .eq("published", true)
    .single();
  if (!profile) return null;
  // An item the creator marked unavailable is hidden from the profile, so a
  // direct link to it 404s too (same rule as every other public listing).
  const product = (profile.products || []).find((p: any) => p.id === id && p.available !== false);
  if (!product) return null;
  return { profile, product };
}

// Shares the profile's own metadata (PWA manifest link, theme color…) and
// swaps in the item's name and photo, so a link shared on WhatsApp/social
// previews the actual product.
export async function generateMetadata(
  { params }: { params: { username: string; id: string } },
  parent: ResolvingMetadata
): Promise<Metadata> {
  const base = await generateProfileMetadata({ params }, parent);
  const found = await getItem(params.username, params.id);
  if (!found) return base;
  const title = `${found.product.name} — ${found.profile.name || found.profile.username}`;
  const image = productImages(found.product)[0];
  return {
    ...base,
    title,
    description: found.product.description || base.description,
    openGraph: { ...base.openGraph, title, ...(image ? { images: [image] } : {}) },
  };
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
