import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { headers, cookies } from "next/headers";
import { extractRequestContext } from "@/lib/requestContext";
import { buildPixelConfigFromRow, isPixelsEnabledForUser, sendMetaPageView, extractClientIp } from "@/lib/pixelTracking";
import ProfileView from "@/components/ProfileView";

// The highest-traffic page in the app, and the one that changes the most
// often (every Editor save touches it) — without this, Next's Data Cache
// can keep serving a stale read of the profile/links/products query
// indefinitely, so a creator's edits don't show up on their own live
// page. See dashboard/subscription/page.tsx for the same reasoning.
export const dynamic = "force-dynamic";

export default async function PublicProfilePage({
  params,
}: {
  params: { username: string };
}) {
  const supabase = createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      `*, social_links(*), links(*), products(*), profile_phone_numbers(*), tracks(*), events(*), menu_items(*)`
    )
    .eq("username", params.username)
    .eq("published", true)
    .single();

  if (!profile) return notFound();

  const { referrer, country, city } = extractRequestContext(headers());
  const clientIp = extractClientIp(headers());
  const userAgent = headers().get("user-agent");
  const host = headers().get("host");
  const eventSourceUrl = referrer || (host ? `https://${host}/${params.username}` : `/${params.username}`);

  // One event id, shared with the browser Pixel's own PageView call (see
  // ProfileView.tsx) — Meta dedupes the two into a single event instead
  // of counting a page view twice, while combining both signals into one
  // higher Event Match Quality entry.
  const pageViewEventId = randomUUID();
  const cookieStore = cookies();
  const pixelConfig = buildPixelConfigFromRow(profile);
  const pixelsEnabled = pixelConfig.facebookPixelId || pixelConfig.tiktokPixelId
    ? await isPixelsEnabledForUser(profile.user_id)
    : false;

  // Fire-and-forget page view event (RLS allows anonymous inserts) +
  // the Meta Conversions API PageView, run together so the CAPI call
  // (a network hop to graph.facebook.com) doesn't add its latency on
  // top of the DB insert's.
  const [trackResult] = await Promise.allSettled([
    supabase.from("click_events").insert({
      profile_id: profile.id,
      target_type: "page",
      referrer,
      country,
      city,
    }),
    pixelsEnabled
      ? sendMetaPageView(pixelConfig, {
          eventId: pageViewEventId,
          eventSourceUrl,
          clientIp,
          userAgent,
          fbp: cookieStore.get("_fbp")?.value || null,
          fbc: cookieStore.get("_fbc")?.value || null,
          ttp: null,
          ttclid: null,
          externalId: cookieStore.get("ringo_vid")?.value || null,
        })
      : Promise.resolve(),
  ]);
  if (trackResult.status === "rejected") console.error("Page view tracking failed:", trackResult.reason);
  else if (trackResult.value?.error) console.error("Page view tracking failed:", trackResult.value.error.message);

  // Never let the encrypted CAPI/Events API tokens reach the browser —
  // Server Components serialize every prop passed to a "use client"
  // child into the page's own payload, so even fields ProfileView never
  // reads would otherwise ship to every anonymous visitor.
  const { facebook_capi_token_encrypted, tiktok_events_token_encrypted, ...publicProfile } = profile;

  return <ProfileView profile={publicProfile} pixelsEnabled={pixelsEnabled} pageViewEventId={pageViewEventId} />;
}
