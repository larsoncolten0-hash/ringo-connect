import { redirect, notFound } from "next/navigation";
import { assertCanApproveRequests } from "@/lib/assertAdmin";
import { resolveRequestAccess } from "@/lib/ambassador/requestReview";
import { confirmSignupPayment } from "@/lib/signupPayment";
import { createAdminClient } from "@/lib/supabase/server";
import RequestReview from "@/components/admin/RequestReview";
import { publicPlans } from "@/lib/association/publicVisibility";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// See src/app/dashboard/requests/page.tsx for why the permission check
// lives here rather than in a shared layout.
export default async function DashboardRequestDetailPage({ params }: { params: { id: string } }) {
  const reviewer = await assertCanApproveRequests();
  if (!reviewer) redirect("/dashboard");

  const admin = createAdminClient();

  const { data: signupRequest } = await admin
    .from("signup_requests")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!signupRequest) notFound();
  // 404, not a "forbidden" page — a reviewer browsing to someone else's
  // request id shouldn't even learn that it exists.
  const access = await resolveRequestAccess(admin, reviewer, signupRequest);
  if (!access) notFound();

  // Same as the admin screen: a payment the customer made but their browser never reported is
  // confirmed here, so a reviewer (including an Ambassador, who may approve ONLY confirmed online
  // payments) is never shown a paid customer as unpaid. Access was already checked above.
  if (signupRequest.status === "pending" && !signupRequest.customer_paid && signupRequest.pending_fapshi_trans_id) {
    try {
      const check = await confirmSignupPayment(admin, params.id);
      if (check.paid) {
        signupRequest.customer_paid = true;
        signupRequest.pending_fapshi_trans_id = check.transId ?? signupRequest.pending_fapshi_trans_id;
      }
    } catch (err: any) {
      console.error("dashboard request page: payment confirmation failed:", err?.message);
    }
  }

  const { data: plans } = await admin.from("plans").select("*").order("price_usd", { ascending: true });
  const { data: addons } = await admin.from("addons").select("*").order("sort_order", { ascending: true });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";

  return (
    <RequestReview
      request={signupRequest}
      plans={publicPlans(plans)}
      addons={addons || []}
      basePath="/dashboard/requests"
      canDelete={reviewer.isAdmin}
      canReject={reviewer.isAdmin}
      canCharge={reviewer.isAdmin}
      requireOnlinePayment={access === "ambassador"}
      siteUrl={siteUrl}
    />
  );
}
