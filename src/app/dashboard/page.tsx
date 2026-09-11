import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Editor from "@/components/Editor";

// See src/app/admin/settings/page.tsx for why this matters: without it,
// navigating back here via the sidebar can show stale cached data.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: userRow } = await supabase
    .from("users")
    .select("*, plans(*)")
    .eq("id", user.id)
    .single();

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      `*, social_links(*), links(*), products(*), profile_phone_numbers(*), tracks(*), events(*), menu_categories(*), menu_items(*), restaurant_tables(*), music_releases(*), booking_services(*)`
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

  return (
    <Editor
      profile={profileForClient}
      plan={userRow?.plans}
      userId={user.id}
      siteUrl={process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com"}
    />
  );
}