import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { opensDashboardFromOutside } from "@/lib/dashboardEntry";
import { ACTIVE_ORG_COOKIE } from "@/lib/team/access";
import Editor from "@/components/Editor";
import { computeProfileCheckoutAvailability } from "@/lib/productCheckout/availability";

// See src/app/admin/settings/page.tsx for why this matters: without it,
// navigating back here via the sidebar can show stale cached data.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Opening the dashboard (an address typed or bookmarked, the installed app, a link from elsewhere) starts on Ringo Home. Moving around inside the app keeps /dashboard as the
  // Editor, exactly as before. Someone acting inside another organization (staff) has no Home in their menu, so they are never sent there.
  const h = headers();
  if (opensDashboardFromOutside({ secFetchSite: h.get("sec-fetch-site"), secFetchMode: h.get("sec-fetch-mode"), referer: h.get("referer"), host: h.get("host"), rsc: h.get("rsc") })) {
    const activeOrg = cookies().get(ACTIVE_ORG_COOKIE)?.value ?? null;
    const { data: own } = await supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle();
    if (own && (!activeOrg || activeOrg === own.id)) redirect("/dashboard/home");
  }

  const { data: userRow } = await supabase
    .from("users")
    .select("*, plans(*)")
    .eq("id", user.id)
    .single();

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      `*, social_links(*), links(*), products(*), profile_phone_numbers(*), tracks(*), events(*, event_ticket_types(*)), menu_categories(*), menu_items(*), restaurant_tables(*), music_releases(*), booking_services(*)`
    )
    .eq("user_id", user.id)
    .single();

  if (!profile) redirect("/auth/login?error=profile_missing");

  // The raw encrypted CAPI/Events API tokens must never reach the
  // browser — Server → Client component props get serialized into the
  // page's own payload regardless of whether the client component reads
  // every field, so even an unused key would otherwise ship to the
  // owner's own browser tab. Swap them for plain "is one saved?" flags,
  // which is all PixelsCard needs to render its "Configured" badges.
  const { facebook_capi_token_encrypted, tiktok_events_token_encrypted, ...profileForClient } = profile;
  (profileForClient as any).facebookCapiConfigured = !!facebook_capi_token_encrypted;
  (profileForClient as any).tiktokEventsConfigured = !!tiktok_events_token_encrypted;
  // Whether product checkout is switched on for this profile (platform + profile rules). The editor
  // applies the product-level rules per row so its hint matches what customers will see.
  (profileForClient as any).commerceCheckoutAvailable = await computeProfileCheckoutAvailability(profile);

  return (
    <Editor
      profile={profileForClient}
      plan={userRow?.plans}
      userId={user.id}
      siteUrl={process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com"}
    />
  );
}