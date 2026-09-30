import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getMyTeamOverview } from "@/lib/ambassador/teamDashboard";
import TeamLeaderDashboardView from "@/components/dashboard/TeamLeaderDashboardView";
import AmbassadorPayoutPanel from "@/components/dashboard/AmbassadorPayoutPanel";
import { getMyPayoutOverview } from "@/lib/ambassador/payouts";
import ClientRequestsCard from "@/components/dashboard/ClientRequestsCard";
import TeamLeaderSelfSellCard from "@/components/dashboard/TeamLeaderSelfSellCard";
import TeamAmbassadorsCard from "@/components/dashboard/TeamAmbassadorsCard";
import { listTeamMembers } from "@/lib/ambassador/teamMembers";
import { pendingScopedRequestCount } from "@/lib/ambassador/requestReview";

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

  // The Team Leader's OWN Ambassador profile, if they added one (to register
  // clients themselves and earn both shares). Only code + status are read.
  const adminClient = createAdminClient();
  const { data: ownAmbassador } = await adminClient.from("ambassador_profiles").select("sales_code, status").eq("user_id", user.id).maybeSingle();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";
  const members = await listTeamMembers(adminClient, user.id);

  // Admin-granted per person (users.can_approve_requests); covers the whole
  // team's clients plus the Team Leader's own, by the team recorded on each sale.
  const { data: reviewerRow } = await adminClient.from("users").select("can_approve_requests").eq("id", user.id).maybeSingle();
  const canApprove = !!reviewerRow?.can_approve_requests;
  const pendingRequests = canApprove ? await pendingScopedRequestCount(adminClient, user.id) : 0;

  return (
    <>
      <TeamLeaderDashboardView overview={overview} />
      <TeamAmbassadorsCard members={members} />
      <TeamLeaderSelfSellCard siteUrl={siteUrl} salesCode={ownAmbassador?.sales_code ?? null} profileStatus={ownAmbassador?.status ?? null} />
      <ClientRequestsCard granted={canApprove} pendingCount={pendingRequests} />
      <AmbassadorPayoutPanel overview={payouts} />
    </>
  );
}
