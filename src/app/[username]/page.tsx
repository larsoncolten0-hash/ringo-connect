import { getPublicOwnerAccount, isPublicProfileSuspended } from "@/lib/publicProfileVisibility";
import { randomUUID } from "crypto";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { headers, cookies } from "next/headers";
import { extractRequestContext } from "@/lib/requestContext";
import { buildPixelConfigFromRow, isPixelsEnabledForUser, sendMetaPageView, extractClientIp } from "@/lib/pixelTracking";
import { isCustomThemeAllowed } from "@/lib/planEntitlements";
import { limitPublicRows, isPublicLink, isPublicProduct } from "@/lib/publicContent";
import { computeProfileCheckoutAvailability } from "@/lib/productCheckout/availability";
import ProfileView from "@/components/ProfileView";
import { buildProfileJsonLd, serializeJsonLd } from "@/lib/seo";

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

type StaffBadge = { orgUsername: string; orgName: string; orgAvatarUrl: string | null; roleName: string };

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
async function loadStaffBadges(profile: any): Promise<StaffBadge[]> {
  if (profile.team_badges_enabled === false) return [];
  const admin = createAdminClient();
  const { data: memberships } = await admin
    .from("organization_members")
    .select("organization_roles(name), profiles(username, name, avatar_url, published)")
    .eq("user_id", profile.user_id)
    .eq("status", "active");

  return (memberships || [])
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

export default async function PublicProfilePage({
  params,
}: {
  params: { username: string };
}) {
  const supabase = createClient();

  // Stage 1: everything that needs only the username or the request's cookies runs TOGETHER: the profile read, the suspension check (one query, see
  // lib/publicProfileVisibility.ts) and the signed-in visitor. They used to be awaited one after another.
  const [{ data: profile }, suspended, authResult] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        `*, social_links(*), links(*), products(*), profile_phone_numbers(*), tracks(*), events(*, event_ticket_types(*)), menu_items(*), music_releases(*), booking_services(*)`
      )
      .eq("username", params.username)
      .eq("published", true)
      .single(),
    isPublicProfileSuspended(params.username),
    supabase.auth.getUser(),
  ]);

  // The gates are exactly what they were: an unknown / unpublished profile and a suspended owner both get the same 404, and nothing below (no read that
  // depends on the profile, no page-view record, no Pixel call) happens before this point.
  if (!profile) return notFound();
  if (suspended) return notFound();

  // The signed-in visitor is only used to suppress FanRecognitionHeader and our own page-view row for the owner's own live view; known here, before the
  // page view is recorded, so the record can be written alongside the other reads instead of after them.
  const user = authResult.data.user;
  const isOwner = user?.id === profile.user_id;

  const { referrer, country, city } = extractRequestContext(headers());
  const clientIp = extractClientIp(headers());
  const userAgent = headers().get("user-agent");
  const host = headers().get("host");
  const eventSourceUrl = referrer || (host ? `https://${host}/${params.username}` : `/${params.username}`);
  // One event id, shared with the browser Pixel's own PageView call (see ProfileView.tsx) — Meta dedupes the two into a single event instead of counting a
  // page view twice, while combining both signals into one higher Event Match Quality entry.
  const pageViewEventId = randomUUID();
  const cookieStore = cookies();
  const pixelConfig = buildPixelConfigFromRow(profile);

  // Stage 2: what needs the profile row runs TOGETHER: the checkout capability, the staff badges, whether this owner's Pixels are active, and the
  // page-view row (RLS allows anonymous inserts; the owner previewing their own page is not a visit, so no row for them, and the click tracking in /api/track
  // is untouched). The page view is only ever recorded after the suspension check above.
  const [commerceCheckoutAvailable, staffBadges, pixelsEnabled, trackSettled] = await Promise.all([
    computeProfileCheckoutAvailability(profile),
    loadStaffBadges(profile),
    pixelConfig.facebookPixelId || pixelConfig.tiktokPixelId ? isPixelsEnabledForUser(profile.user_id) : Promise.resolve(false),
    Promise.allSettled([
      isOwner
        ? Promise.resolve({ error: null })
        : supabase.from("click_events").insert({
            profile_id: profile.id,
            target_type: "page",
            referrer,
            country,
            city,
          }),
    ]),
  ]);
  const trackResult = trackSettled[0];
  if (trackResult.status === "rejected") console.error("Page view tracking failed:", trackResult.reason);
  else if ((trackResult.value as any)?.error) console.error("Page view tracking failed:", (trackResult.value as any).error.message);

  // Subscription controls ACCESS, never data retention (see planEntitlements.ts): a downgraded
  // creator's extra links/products/theme customization stay fully intact in the database — only
  // what's currently visible on THIS public page is limited to what their CURRENT plan allows. The
  // owner viewing their own dashboard still sees and can edit everything regardless (see
  // dashboard/page.tsx, untouched by this).
  //
  // Fetched with the admin client, same reasoning as staffBadges below: an anonymous visitor has no
  // RLS access to the `users` table at all, so embedding `users!user_id(plans(...))` in the plain
  // anon-key query above would silently resolve to null for every real visitor (confirmed live —
  // RLS filters an embedded to-one relation to null rather than erroring, so this failure mode is
  // completely silent unless checked against the anon key specifically, not just the service role).
  // The owner's plan came back with the suspension check (one memoised query, see lib/publicProfileVisibility.ts): no separate read.
  const ownerPlan = (await getPublicOwnerAccount(params.username)).plan;
  // Rows with nothing to show (an empty link, a nameless product) are dropped BEFORE the plan limit, so they
  // never use up one of the owner's visible slots (see lib/publicContent.ts). Display only; nothing is changed.
  const { visible: visibleLinks } = limitPublicRows<any>(profile.links, isPublicLink, ownerPlan?.max_links ?? null);
  const { visible: visibleProducts } = limitPublicRows<any>(profile.products, isPublicProduct, ownerPlan?.max_products ?? null);
  profile.links = visibleLinks;
  profile.products = visibleProducts;
  if (!isCustomThemeAllowed(ownerPlan)) {
    // Same literal values as the profiles table's own column defaults (see ThemeCard.tsx's own
    // DEFAULTS constant) — never touches what's actually stored, so upgrading again immediately
    // restores the creator's real saved theme with no extra step.
    profile.theme_color = "#D4A954";
    profile.background_style = "solid";
    profile.background_color = "#0A0A0A";
    profile.background_gradient_end = null;
    profile.text_color = "#FAFAFA";
    profile.button_style = "outline";
    profile.button_radius = "rounded";
  }

  // The Meta Conversions API PageView (a network hop to graph.facebook.com), only for an owner whose Pixels are active.
  await Promise.allSettled([
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

  // Never let the encrypted CAPI/Events API tokens reach the browser —
  // Server Components serialize every prop passed to a "use client"
  // child into the page's own payload, so even fields ProfileView never
  // reads would otherwise ship to every anonymous visitor.
  const { facebook_capi_token_encrypted, tiktok_events_token_encrypted, ...publicProfile } = profile;
  // Same profile-level check the dashboard editor's own catalog card already uses (see
  // dashboard/page.tsx) — CatalogSection resolves each product's own CTA button text/destination
  // (Buy Now / Book Now / Shop Now / etc., matching the item's own detail page) from this plus each
  // product's own fields, entirely client-side, no per-product server round trip.
  (publicProfile as any).commerceCheckoutAvailable = commerceCheckoutAvailable;

  // Structured data for search engines: only public, displayed fields (see lib/seo.ts); null for a demo profile.
  const jsonLd = buildProfileJsonLd(publicProfile as any);

  return (
    <>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />}
      <ProfileView
        profile={publicProfile}
        pixelsEnabled={pixelsEnabled}
        pageViewEventId={pageViewEventId}
        staffBadges={staffBadges}
        isOwner={isOwner}
      />
    </>
  );
}
