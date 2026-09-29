import { redirect, notFound } from "next/navigation";
import { assertCanApproveRequests } from "@/lib/assertAdmin";
import { resolveRequestAccess } from "@/lib/ambassador/requestReview";
import { createAdminClient } from "@/lib/supabase/server";
import RequestReview from "@/components/admin/RequestReview";
import { publicPlans } from "@/lib/association/publicVisibility";

export const dynamic = "force-dynamic";

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
