import { redirect, notFound } from "next/navigation";
import { assertCanApproveRequests } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import RequestReview from "@/components/admin/RequestReview";

export const dynamic = "force-dynamic";

// See src/app/dashboard/requests/page.tsx for why the permission check
// lives here rather than in a shared layout.
export default async function DashboardRequestDetailPage({ params }: { params: { id: string } }) {
  const user = await assertCanApproveRequests();
  if (!user) redirect("/dashboard");

  const admin = createAdminClient();

  const { data: signupRequest } = await admin
    .from("signup_requests")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!signupRequest) notFound();

  const { data: plans } = await admin.from("plans").select("*").order("price_usd", { ascending: true });
  const { data: addons } = await admin.from("addons").select("*").order("sort_order", { ascending: true });

  return (
    <RequestReview
      request={signupRequest}
      plans={plans || []}
      addons={addons || []}
      basePath="/dashboard/requests"
    />
  );
}
