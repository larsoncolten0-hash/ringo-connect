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
  // The profile read and the suspension check both start from the username: they run together (the page used to wait for one, then the other).
  const [{ data: profile }, suspended] = await Promise.all([
    supabase
      .from("profiles")
      .select(`*, social_links(*), tracks(*), music_releases(*), products(*), events(*, event_ticket_types(*))`)
      .eq("username", username)
      .eq("published", true)
      .single(),
    isPublicProfileSuspended(username),
  ]);

  if (!profile || !profileHasCategory(profile, "music_entertainment")) return notFound();
  if (suspended) return notFound();

  const { data: ownerPlanRow } = await createAdminClient().from("users").select("plans(max_products)").eq("id", profile.user_id).maybeSingle();
  const { visible: visibleProducts } = limitPublicRows<any>(profile.products, isPublicProduct, (ownerPlanRow as any)?.plans?.max_products ?? null);
  // These pages hand the whole profile to the browser: the encrypted Pixel / Conversions API tokens and the test code are never sent (the main profile page strips them the same way).
  const { facebook_capi_token_encrypted, tiktok_events_token_encrypted, facebook_test_event_code, ...publicProfile } = profile as any;
  return { ...publicProfile, products: visibleProducts };
}
