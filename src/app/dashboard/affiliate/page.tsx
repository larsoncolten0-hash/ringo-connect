import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getMyAffiliateOverview } from "@/lib/affiliate";
import AffiliateView from "@/components/dashboard/AffiliateView";

// See src/app/admin/settings/page.tsx for why this matters — balances and
// payout status here need to always be current, never a cached snapshot.
export const dynamic = "force-dynamic";

export default async function AffiliatePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const overview = await getMyAffiliateOverview();
  // Only null if the affiliate migration hasn't been run yet (no
  // affiliate_code on this row) — everything else defaults to empty/zero.
  if (!overview) redirect("/dashboard");

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";

  return <AffiliateView overview={overview} siteUrl={siteUrl} />;
}
