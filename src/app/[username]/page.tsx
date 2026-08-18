import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { extractRequestContext } from "@/lib/requestContext";
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
      `*, social_links(*), links(*), products(*), profile_phone_numbers(*)`
    )
    .eq("username", params.username)
    .eq("published", true)
    .single();

  if (!profile) return notFound();

  // Fire-and-forget page view event (RLS allows anonymous inserts).
  const { referrer, country, city } = extractRequestContext(headers());
  const { error: trackError } = await supabase.from("click_events").insert({
    profile_id: profile.id,
    target_type: "page",
    referrer,
    country,
    city,
  });
  if (trackError) console.error("Page view tracking failed:", trackError.message);

  return <ProfileView profile={profile} />;
}