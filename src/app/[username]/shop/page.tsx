import type { Metadata, ResolvingMetadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { memoPerRequest } from "@/lib/requestMemo";
import { isPublicProfileSuspended } from "@/lib/publicProfileVisibility";
import { profileHasCategory, profileHasTicketing, getCategory } from "@/lib/categories";
import { limitPublicRows, isPublicProduct } from "@/lib/publicContent";
import { computeProfileCheckoutAvailability } from "@/lib/productCheckout/availability";
import { generateMetadata as generateProfileMetadata, generateViewport } from "@/lib/profileMetadata";
import { NOINDEX, withItemSeo } from "@/lib/seo";
import { productImages } from "@/components/catalog/productHref";
import ShopDestination from "@/components/shop/ShopDestination";

export { generateViewport };

// The dedicated commercial page of a profile's catalog: "Shop" for a business that sells products, "Services" for a clinic or a studio, "Courses",
// "Listings", "Rooms & packages"... worded from the category's own catalog label. The public profile stays the short discovery layer (a curated
// rail of the first items); this is where a visitor browses everything. Reads exactly what the profile reads, with the same rules: only a published,
// non-suspended profile, only items with a name that are not hidden, and never more than the owner's current plan allows (planEntitlements.ts).
// Buying, booking and contacting still happen on each item's own page, through the existing flows. Nothing is written.
//
// Music & Entertainment and Events & Experiences already have their dedicated storefront (/m/[username]); this route sends those profiles there rather
// than building a second one. A Restaurant & Food profile keeps its MENU at /r/[username] and its SHOP (the products it sells) is this page.
export const dynamic = "force-dynamic";

// Memoised per request: generateMetadata and the page load the same profile and products.
const load = memoPerRequest(async function load(username: string) {
  const supabase = createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*, products(*)")
    .eq("username", username)
    .eq("published", true)
    .single();
  if (!profile) return null;
  if (await isPublicProfileSuspended(username)) return null;
  return profile;
});

export async function generateMetadata({ params }: { params: { username: string } }, parent: ResolvingMetadata): Promise<Metadata> {
  const profile = await load(params.username);
  // A page that would 404 (or redirect to another storefront) advertises nothing of its own.
  if (!profile || profileHasTicketing(profile)) return { robots: NOINDEX };
  const base = await generateProfileMetadata({ params }, parent);
  const label = getCategory(profile.category)?.defaults.catalogLabel?.en || "Shop";
  const firstImage = (profile.products || []).map((p: any) => productImages(p)[0]).find(Boolean);
  return withItemSeo(base, {
    path: `/${encodeURIComponent(params.username)}/shop`,
    title: `${label} — ${profile.name || profile.username}`,
    description: profile.bio,
    image: firstImage || profile.avatar_url,
  });
}

export default async function ShopRoute({ params }: { params: { username: string } }) {
  const profile = await load(params.username);
  if (!profile) return notFound();
  if (profileHasTicketing(profile)) redirect(`/m/${params.username}`);
  // A restaurant's SHOP is its products, and it shows them here like any other shop. Its MENU is a different thing with its own page (/r/[username]);
  // this route used to send restaurants to the menu, so "Shop > View all" opened the menu. It must not.

  // Same visibility and plan limit as the profile page (see [username]/page.tsx): fetched with the admin client because an anonymous visitor
  // cannot read the owner's plan row. Hidden or unavailable items are never listed.
  const { data: ownerPlanRow } = await createAdminClient().from("users").select("plans(max_products)").eq("id", profile.user_id).maybeSingle();
  const { visible } = limitPublicRows<any>(profile.products, isPublicProduct, (ownerPlanRow as any)?.plans?.max_products ?? null);
  const products = visible.filter((p: any) => p.available !== false);

  // Only what the shop page shows leaves the server: no tracking tokens, no private columns of the profile.
  const publicProfile = {
    username: profile.username,
    name: profile.name,
    bio: profile.bio,
    avatar_url: profile.avatar_url,
    cover_image_url: profile.cover_image_url ?? null,
    about_location: profile.about_location ?? null,
    verified: !!profile.verified,
    category: profile.category,
    currency: profile.currency,
    bookings_enabled: !!profile.bookings_enabled,
    restaurant_ordering: profileHasCategory(profile, "restaurant_food") && profile.ordering_enabled !== false,
    is_demo: profile.is_demo === true,
    profile_id: profile.id,
    commerceCheckoutAvailable: await computeProfileCheckoutAvailability(profile),
  };

  return <ShopDestination profile={publicProfile} products={products} />;
}
