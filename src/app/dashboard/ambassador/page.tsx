import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getMyAmbassadorOverview } from "@/lib/ambassador/dashboard";
import AmbassadorDashboardView from "@/components/dashboard/AmbassadorDashboardView";
import AmbassadorPayoutPanel from "@/components/dashboard/AmbassadorPayoutPanel";
import { getMyPayoutOverview } from "@/lib/ambassador/payouts";
import ClientRequestsCard from "@/components/dashboard/ClientRequestsCard";
import PendingAmbassadorNotice from "@/components/dashboard/PendingAmbassadorNotice";
import { pendingScopedRequestCount } from "@/lib/ambassador/requestReview";

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

  // Added by a Team Leader and not yet approved by Ringo Management: show ONLY a
  // notice — no code, link, figures, requests or payouts until they are approved.
  if (overview.ambassador.status === "pending") return <PendingAmbassadorNotice />;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";

  // Phase H — the caller's own payout figures, resolved from their session id.
  const payouts = await getMyPayoutOverview(createAdminClient(), user.id, "ambassador");

  // Approving their own clients' new accounts is granted per person by an admin
  // (users.can_approve_requests, the same switch as super creators). Read
  // server-side from the session user; the review screen and the approve API
  // enforce the actual rules.
  const adminClient = createAdminClient();
  const { data: reviewerRow } = await adminClient.from("users").select("can_approve_requests").eq("id", user.id).maybeSingle();
  const canApprove = !!reviewerRow?.can_approve_requests;
  const pendingRequests = canApprove ? await pendingScopedRequestCount(adminClient, user.id) : 0;

  return (
    <>
      <AmbassadorDashboardView overview={overview} siteUrl={siteUrl} />
      <ClientRequestsCard granted={canApprove} pendingCount={pendingRequests} />
      <AmbassadorPayoutPanel overview={payouts} />
    </>
  );
}
