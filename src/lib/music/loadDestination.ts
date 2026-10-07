import "server-only";
import { notFound } from "next/navigation";
import { isPublicProfileSuspended } from "@/lib/publicProfileVisibility";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { profileHasCategory } from "@/lib/categories";
import { isPublicProduct, limitPublicRows } from "@/lib/publicContent";

// What a Music destination page (/m/<username>/music | merch | tickets) needs: the same published profile rows the artist's profile reads, with the same rules (suspended owner =
// not found; the owner's CURRENT plan limits the visible products). Read-only. No payment, cart or order logic lives here: a destination only links to the item pages and the one
// storefront checkout that already exist.
export async function loadMusicDestination(username: string) {
  const supabase = createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select(`*, social_links(*), tracks(*), music_releases(*), products(*), events(*, event_ticket_types(*))`)
    .eq("username", username)
    .eq("published", true)
    .single();

  if (!profile || !profileHasCategory(profile, "music_entertainment")) return notFound();
  if (await isPublicProfileSuspended(username)) return notFound();

  const { data: ownerPlanRow } = await createAdminClient().from("users").select("plans(max_products)").eq("id", profile.user_id).maybeSingle();
  const { visible: visibleProducts } = limitPublicRows<any>(profile.products, isPublicProduct, (ownerPlanRow as any)?.plans?.max_products ?? null);
  return { ...profile, products: visibleProducts };
}
