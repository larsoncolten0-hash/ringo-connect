import { createClient, createAdminClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { profileHasCategory } from "@/lib/categories";
import RestaurantOrderPage from "@/components/restaurant/RestaurantOrderPage";

// See src/app/[username]/page.tsx's own comment — same shared metadata
// (the manifest always points back at the general /username profile URL,
// not this ordering page, regardless of which page a visitor arrived on).
export { generateMetadata, generateViewport } from "@/lib/profileMetadata";

// The actual ordering surface — reachable from the public profile's
// "View Menu"/"Order Now" buttons, or directly via a table's QR code
// (?table=<public_code>, baked into the QR by TablesCard so the customer
// never has to type a table number).
export const dynamic = "force-dynamic";

export default async function RestaurantOrderRoute({
  params,
  searchParams,
}: {
  params: { username: string };
  searchParams: { table?: string };
}) {
  const supabase = createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select(`*, menu_categories(*), menu_items(*)`)
    .eq("username", params.username)
    .eq("published", true)
    .single();

  if (!profile || !profileHasCategory(profile, "restaurant_food")) return notFound();

  // restaurant_tables has no public RLS policy on purpose (a competitor
  // shouldn't be able to enumerate a restaurant's tables) — resolving a
  // scanned code to a real table has to go through the admin client,
  // scoped to exactly this profile and an enabled table only.
  let table: { id: string; label: string } | null = null;
  const code = searchParams.table?.trim().toUpperCase();
  if (code) {
    const admin = createAdminClient();
    const { data: tableRow } = await admin
      .from("restaurant_tables")
      .select("id, label")
      .eq("profile_id", profile.id)
      .eq("public_code", code)
      .eq("enabled", true)
      .maybeSingle();
    table = tableRow;
  }

  return <RestaurantOrderPage profile={profile} table={table} />;
}
