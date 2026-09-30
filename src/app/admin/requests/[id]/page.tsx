import { createAdminClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import RequestReview from "@/components/admin/RequestReview";
import { confirmSignupPayment } from "@/lib/signupPayment";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function AdminRequestDetailPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: signupRequest } = await admin
    .from("signup_requests")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!signupRequest) notFound();

  // If the customer paid online but their browser stopped watching, record it now so this screen
  // shows "Paid online" instead of asking the admin to mark it as cash.
  if (signupRequest.status === "pending" && !signupRequest.customer_paid && signupRequest.pending_fapshi_trans_id) {
    try {
      const check = await confirmSignupPayment(admin, params.id);
      if (check.paid) {
        signupRequest.customer_paid = true;
        signupRequest.pending_fapshi_trans_id = check.transId ?? signupRequest.pending_fapshi_trans_id;
      }
    } catch (err: any) {
      console.error("admin request page: payment confirmation failed:", err?.message);
    }
  }

  const { data: plans } = await admin.from("plans").select("*").order("price_usd", { ascending: true });
  const { data: addons } = await admin.from("addons").select("*").order("sort_order", { ascending: true });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";

  return <RequestReview request={signupRequest} plans={plans || []} addons={addons || []} siteUrl={siteUrl} />;
}