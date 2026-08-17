import { createAdminClient } from "@/lib/supabase/server";
import RequestsTable from "@/components/admin/RequestsTable";

export const dynamic = "force-dynamic";

export default async function AdminRequestsPage() {
  const admin = createAdminClient();

  const { data: requests } = await admin
    .from("signup_requests")
    .select("*, plans(display_name, name)")
    .order("created_at", { ascending: false });

  return <RequestsTable requests={requests || []} />;
}
