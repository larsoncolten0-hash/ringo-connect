import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getMyTeamOverview } from "@/lib/ambassador/teamDashboard";
import TeamLeaderDashboardView from "@/components/dashboard/TeamLeaderDashboardView";
import AmbassadorPayoutPanel from "@/components/dashboard/AmbassadorPayoutPanel";
import { getMyPayoutOverview } from "@/lib/ambassador/payouts";

// Same reasoning as /dashboard/ambassador/page.tsx and
// /dashboard/affiliate/page.tsx — commission/activation status here needs
// to always be current, never a cached snapshot.
export const dynamic = "force-dynamic";

export default async function SalesTeamPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const overview = await getMyTeamOverview(user.id);
  // Only null if this account has no ambassador_teams row as a Team
  // Leader — everything else defaults to empty/zero.
  if (!overview) redirect("/dashboard");

  // Phase H — the Team Leader's own payout figures (recipient_type = team_leader
  // rows for THIS user only; an Ambassador's payouts/destinations are never read).
  const payouts = await getMyPayoutOverview(createAdminClient(), user.id, "team_leader");

  return (
    <>
      <TeamLeaderDashboardView overview={overview} />
      <AmbassadorPayoutPanel overview={payouts} />
    </>
  );
}
