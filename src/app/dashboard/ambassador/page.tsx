import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getMyAmbassadorOverview } from "@/lib/ambassador/dashboard";
import AmbassadorDashboardView from "@/components/dashboard/AmbassadorDashboardView";
import AmbassadorPayoutPanel from "@/components/dashboard/AmbassadorPayoutPanel";
import { getMyPayoutOverview } from "@/lib/ambassador/payouts";

// Same reasoning as /dashboard/affiliate/page.tsx — commission/activation
// status here needs to always be current, never a cached snapshot.
export const dynamic = "force-dynamic";

export default async function AmbassadorPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const overview = await getMyAmbassadorOverview(user.id);
  // Only null if this account has no ambassador_profiles row at all —
  // everything else defaults to empty/zero, same posture as the
  // affiliate dashboard's own null-check.
  if (!overview) redirect("/dashboard");

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";

  // Phase H — the caller's own payout figures, resolved from their session id.
  const payouts = await getMyPayoutOverview(createAdminClient(), user.id, "ambassador");

  return (
    <>
      <AmbassadorDashboardView overview={overview} siteUrl={siteUrl} />
      <AmbassadorPayoutPanel overview={payouts} />
    </>
  );
}
