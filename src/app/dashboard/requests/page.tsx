import { redirect } from "next/navigation";
import { assertCanApproveRequests } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import RequestsTable from "@/components/admin/RequestsTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

// Reachable by full admins too, but they'd normally use /admin/requests —
// this route exists for "super creators": regular creators an admin has
// granted can_approve_requests to, without giving them the rest of
// /admin (settings, plans, affiliate payouts, the creators list, etc).
// The permission check happens right here rather than in a shared
// layout, on purpose — dashboard/layout.tsx is not a security boundary
// for anything else it wraps, so this page must gate itself.
export default async function DashboardRequestsPage({ searchParams }: { searchParams: { page?: string } }) {
  const reviewer = await assertCanApproveRequests();
  if (!reviewer) redirect("/dashboard");

  const admin = createAdminClient();
  const page = Math.max(1, parseInt(searchParams?.page || "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let listQuery = admin
    .from("signup_requests")
    .select("*, plans(display_name, name)", { count: "exact" })
    .order("created_at", { ascending: false });
  let pendingCountQuery = admin.from("signup_requests").select("id", { count: "exact", head: true }).eq("status", "pending");

  // A super creator only ever sees requests that came in through their
  // own affiliate link (referral_code === their own affiliate_code) —
  // never anyone else's. A full admin is unscoped, same as /admin/requests.
  if (!reviewer.isAdmin) {
    if (reviewer.affiliateCode) {
      listQuery = listQuery.eq("referral_code", reviewer.affiliateCode);
      pendingCountQuery = pendingCountQuery.eq("referral_code", reviewer.affiliateCode);
    } else {
      // No affiliate_code yet — show nothing rather than everything.
      listQuery = listQuery.eq("id", "00000000-0000-0000-0000-000000000000");
      pendingCountQuery = pendingCountQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    }
  }

  const [{ data: requests, count }, { count: pendingCount }] = await Promise.all([
    listQuery.range(from, to),
    pendingCountQuery,
  ]);

  return (
    <RequestsTable
      requests={requests || []}
      basePath="/dashboard/requests"
      canDelete={reviewer.isAdmin}
      page={page}
      pageSize={PAGE_SIZE}
      totalCount={count ?? 0}
      pendingCount={pendingCount ?? 0}
    />
  );
}
