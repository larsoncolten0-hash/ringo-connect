import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AnalyticsView from "@/components/AnalyticsView";

export default async function AnalyticsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!profile) redirect("/auth/login?error=profile_missing");

  console.log("Analytics: fetching click_events for profile.id =", profile.id);

  // Capped at a generous limit — fine for a link-in-bio's realistic click
  // volume. A high-traffic profile would eventually want server-side
  // aggregation (e.g. a Postgres view grouped by day) instead of shipping
  // raw rows to the client.
  const [{ data: events, error: eventsError }, { data: links, error: linksError }, { data: products, error: productsError }] =
    await Promise.all([
      supabase
        .from("click_events")
        .select("target_type, target_id, referrer, country, created_at")
        .eq("profile_id", profile.id)
        .order("created_at", { ascending: true })
        .limit(20000),
      supabase.from("links").select("id, title").eq("profile_id", profile.id),
      supabase.from("products").select("id, name").eq("profile_id", profile.id),
    ]);

  if (eventsError) console.error("Analytics: click_events query failed:", eventsError.message);
  if (linksError) console.error("Analytics: links query failed:", linksError.message);
  if (productsError) console.error("Analytics: products query failed:", productsError.message);

  return <AnalyticsView events={events || []} links={links || []} products={products || []} />;
}