import { redirect } from "next/navigation";
import { assertCanApproveRequests } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import RequestsTable from "@/components/admin/RequestsTable";

export const dynamic = "force-dynamic";

// Reachable by full admins too, but they'd normally use /admin/requests —
// this route exists for "super creators": regular creators an admin has
// granted can_approve_requests to, without giving them the rest of
// /admin (settings, plans, affiliate payouts, the creators list, etc).
// The permission check happens right here rather than in a shared
// layout, on purpose — dashboard/layout.tsx is not a security boundary
// for anything else it wraps, so this page must gate itself.
export default async function DashboardRequestsPage() {
  const user = await assertCanApproveRequests();
  if (!user) redirect("/dashboard");

  const admin = createAdminClient();
  const { data: requests } = await admin
    .from("signup_requests")
    .select("*, plans(display_name, name)")
    .order("created_at", { ascending: false });

  return <RequestsTable requests={requests || []} basePath="/dashboard/requests" />;
}
