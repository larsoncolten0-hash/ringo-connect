import { randomUUID } from "crypto";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { headers, cookies } from "next/headers";
import { extractRequestContext } from "@/lib/requestContext";
import { buildPixelConfigFromRow, isPixelsEnabledForUser, sendMetaPageView, extractClientIp } from "@/lib/pixelTracking";
import ProfileView from "@/components/ProfileView";

// Per-profile PWA installability (manifest link, iOS home-screen name/
// icon, theme color) + page title/description — see
// src/lib/profileMetadata.ts. Same export re-used by r/[username] and
// m/[username] below.
export { generateMetadata, generateViewport } from "@/lib/profileMetadata";

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
      `*, social_links(*), links(*), products(*), profile_phone_numbers(*), tracks(*), events(*, event_ticket_types(*)), menu_items(*), music_releases(*), booking_services(*)`
    )
    .eq("username", params.username)
    .eq("published", true)
    .single();

  if (!profile) return notFound();

  // Only ever used to suppress FanRecognitionHeader for the owner's own
  // live view (see that component's comment) — this page is already
  // force-dynamic (see above), so one extra auth read costs nothing this
  // route doesn't already pay for a signed-in visitor's cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwner = user?.id === profile.user_id;

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

  // Public "current role" badge(s) — e.g. "Chef at Mama's Kitchen" — live-
  // derived from active organization_members rows every render (never a
  // stored copy, so being removed from a team makes the badge disappear
  // automatically). Governed by one global opt-out
  // (profiles.team_badges_enabled, default true — see AvatarMenu.tsx).
  //
  // Fetched with the admin client: an anonymous visitor has no RLS access
  // to organization_members/organization_roles at all ("staff.view or
  // your own row" — a public visitor is neither), the same posture every
  // other public-page read of cross-tenant data in this app already uses
  // (see /r/[username]/page.tsx for the identical createAdminClient()
  // pattern). Only ever returns non-sensitive, already-public fields
  // (an org's own name/username/avatar, a role's own name).
  let staffBadges: { orgUsername: string; orgName: string; orgAvatarUrl: string | null; roleName: string }[] = [];
  if (profile.team_badges_enabled !== false) {
    const admin = createAdminClient();
    const { data: memberships } = await admin
      .from("organization_members")
      .select("organization_roles(name), profiles(username, name, avatar_url, published)")
      .eq("user_id", profile.user_id)
      .eq("status", "active");

    staffBadges = (memberships || [])
      .map((m: any) => ({
        orgUsername: m.profiles?.username as string | undefined,
        orgName: (m.profiles?.name || m.profiles?.username) as string | undefined,
        orgAvatarUrl: (m.profiles?.avatar_url ?? null) as string | null,
        roleName: m.organization_roles?.name as string | undefined,
        published: m.profiles?.published as boolean | undefined,
      }))
      // Only a badge that can actually be clicked through to a real,
      // reachable page — an org profile that isn't published 404s on
      // /[username] itself, so no point linking to it.
      .filter((b): b is { orgUsername: string; orgName: string; orgAvatarUrl: string | null; roleName: string; published: boolean } =>
        !!b.orgUsername && !!b.roleName && b.published !== false
      )
      .map(({ orgUsername, orgName, orgAvatarUrl, roleName }) => ({ orgUsername, orgName: orgName!, orgAvatarUrl, roleName }));
  }

  return (
    <ProfileView
      profile={publicProfile}
      pixelsEnabled={pixelsEnabled}
      pageViewEventId={pageViewEventId}
      staffBadges={staffBadges}
      isOwner={isOwner}
    />
  );
}
