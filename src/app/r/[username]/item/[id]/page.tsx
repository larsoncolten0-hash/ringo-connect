import { isPublicProfileSuspended } from "@/lib/publicProfileVisibility";
import type { Metadata, ResolvingMetadata } from "next";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { memoPerRequest } from "@/lib/requestMemo";
import { profileHasCategory } from "@/lib/categories";
import { generateMetadata as generateProfileMetadata, generateViewport } from "@/lib/profileMetadata";
import { NOINDEX, withItemSeo } from "@/lib/seo";
import MenuItemDetailView from "@/components/restaurant/MenuItemDetailView";

export { generateViewport };

// One restaurant menu item on its own page — the deep link a creator shares ("we just added
// this dish") so the customer lands on that exact dish, not at the top of the whole menu.
// Ordering still happens on /r/[username] (this page's button opens it with the dish already in
// the cart). A dish that has been deleted sends the visitor to the menu instead of a dead end.
export const dynamic = "force-dynamic";

// Memoised per request: generateMetadata and the page both call it with the same arguments and used to run the same profile + menu query twice.
const getItem = memoPerRequest(async function getItem(username: string, id: string) {
  const supabase = createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*, menu_items(*), menu_categories(*)")
    .eq("username", username)
    .eq("published", true)
    .single();
  if (!profile || !profileHasCategory(profile, "restaurant_food")) return null;
  if (await isPublicProfileSuspended(username)) return null;
  const item = (profile.menu_items || []).find((i: any) => i.id === id);
  return { profile, item: item ?? null };
});

export async function generateMetadata({ params }: { params: { username: string; id: string } }, parent: ResolvingMetadata): Promise<Metadata> {
  const found = await getItem(params.username, params.id);
  // A missing dish redirects to the menu and an unknown profile 404s: neither advertises an item.
  if (!found?.item) return { robots: NOINDEX };
  const base = await generateProfileMetadata({ params }, parent);
  return withItemSeo(base, {
    path: `/r/${encodeURIComponent(params.username)}/item/${encodeURIComponent(params.id)}`,
    title: `${found.item.name} — ${found.profile.name || found.profile.username}`,
    description: found.item.description,
    image: found.item.image_urls?.[0] || found.item.image_url,
  });
}

export default async function MenuItemRoute({ params }: { params: { username: string; id: string } }) {
  const found = await getItem(params.username, params.id);
  if (!found) return notFound();
  if (!found.item) redirect(`/r/${params.username}`);

  const category = (found.profile.menu_categories || []).find((c: any) => c.id === found.item.menu_category_id);
  return <MenuItemDetailView profile={found.profile} item={found.item} categoryName={category?.name ?? null} />;
}
