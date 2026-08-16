import { createAdminClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import RequestReview from "@/components/admin/RequestReview";

export const dynamic = "force-dynamic";

export default async function AdminRequestDetailPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: signupRequest } = await admin
    .from("signup_requests")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!signupRequest) notFound();

  const { data: plans } = await admin.from("plans").select("*").order("price_usd", { ascending: true });

  return <RequestReview request={signupRequest} plans={plans || []} />;
}