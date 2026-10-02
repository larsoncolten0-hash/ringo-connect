import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { siteBase } from "@/lib/deepLinks";
import RingoHome, { type HomeActivity } from "@/components/guidance/RingoHome";
import { computeProfileHealth, detectMilestones } from "@/lib/profileHealth";

// Ringo Home: "How is my Ringo doing, and what should I do next?"
//
// Read-only. Everything here is derived at request time from rows that already exist: the profile
// and its related rows, the plan flags, and COUNTS of click_events / paid orders / community
// members. Nothing is written, no table is added, and any figure that cannot be read is simply left
// out (never replaced with a made-up number). The scoring rules live in src/lib/profileHealth.
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

export default async function RingoHomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [{ data: userRow }, { data: profile }] = await Promise.all([
    supabase.from("users").select("plans(*)").eq("id", user.id).single(),
    // Same embeds the Editor already loads; ids/images only, since only presence and counts matter here.
    supabase
      .from("profiles")
      .select(
        "*, social_links(id), links(id), products(id, image_url), menu_items(id, image_url), tracks(id), music_releases(id), events(id)"
      )
      .eq("user_id", user.id)
      .single(),
  ]);
  if (!profile) redirect("/auth/login?error=profile_missing");

  const now = Date.now();
  const since7 = new Date(now - 7 * DAY).toISOString();
  const since14 = new Date(now - 14 * DAY).toISOString();
  const clicks = () => supabase.from("click_events").select("id", { count: "exact", head: true }).eq("profile_id", profile.id);

  const [total, week, prevWeek, links7, whatsapp7, orders, community] = await Promise.all([
    clicks().eq("target_type", "page"),
    clicks().eq("target_type", "page").gte("created_at", since7),
    clicks().eq("target_type", "page").gte("created_at", since14).lt("created_at", since7),
    clicks().eq("target_type", "link").gte("created_at", since7),
    clicks().eq("target_type", "whatsapp").gte("created_at", since7),
    supabase.from("product_orders").select("id", { count: "exact", head: true }).eq("profile_id", profile.id).in("status", ["paid", "fulfilled"]).not("paid_at", "is", null),
    supabase.from("community_subscribers").select("id", { count: "exact", head: true }).eq("profile_id", profile.id).eq("status", "active"),
  ]);
  // A failed count is "unknown", not zero.
  const n = (r: { count: number | null; error: unknown }) => (r.error || r.count === null ? undefined : r.count);

  const activity: HomeActivity = {
    totalPageViews: n(total),
    pageViews7d: n(week),
    pageViewsPrev7d: n(prevWeek),
    linkClicks7d: n(links7),
    whatsappClicks7d: n(whatsapp7),
  };

  const plan = (userRow?.plans as any) ?? null;
  const health = computeProfileHealth({ profile, plan, activity });

  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  const offeringCount = len(profile.products) + len(profile.menu_items) + len(profile.tracks) + len(profile.music_releases) + len(profile.events);
  const milestones = detectMilestones({
    published: profile.published !== false,
    isComplete: health.isComplete,
    totalPageViews: activity.totalPageViews,
    offeringCount,
    paidOrders: n(orders),
    communityMembers: n(community),
  });

  const displayName = (profile.name || "").trim();
  const firstName = displayName.split(/\s+/)[0] || "";
  const profileUrl = `${siteBase(process.env.NEXT_PUBLIC_SITE_URL)}/${profile.username}`;

  return (
    <RingoHome
      firstName={firstName}
      profileId={profile.id}
      profileUrl={profileUrl}
      shareTitle={displayName || profile.username}
      health={health}
      activity={activity}
      milestones={milestones}
    />
  );
}
