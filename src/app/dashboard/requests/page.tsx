import { redirect } from "next/navigation";
import { assertCanApproveRequests } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import RequestsTable from "@/components/admin/RequestsTable";
import { getReviewerScope, scopedSignupRequestIds } from "@/lib/ambassador/requestReview";
import { reconcileSignupPayments } from "@/lib/signupPayment";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

  // A non-admin reviewer only ever sees THEIR requests — never anyone else's:
  //   * requests that came in through their own affiliate link
  //     (referral_code === their affiliate_code), and/or
  //   * their Ambassador Program clients (an Ambassador's own; a Team
  //     Leader's whole team, by the team recorded on each sale).
  // A full admin is unscoped, same as /admin/requests.
  if (!reviewer.isAdmin) {
    const conditions: string[] = [];
    if (reviewer.affiliateCode && /^[A-Za-z0-9_-]+$/.test(reviewer.affiliateCode)) conditions.push(`referral_code.eq.${reviewer.affiliateCode}`);
    const scopedIds = (await scopedSignupRequestIds(admin, await getReviewerScope(admin, reviewer.id))).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (scopedIds.length) conditions.push(`id.in.(${scopedIds.join(",")})`);
    if (conditions.length) {
      listQuery = listQuery.or(conditions.join(","));
      pendingCountQuery = pendingCountQuery.or(conditions.join(","));
    } else {
      // Nothing of theirs — show nothing rather than everything.
      listQuery = listQuery.eq("id", "00000000-0000-0000-0000-000000000000");
      pendingCountQuery = pendingCountQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    }
  }

  const [{ data: requests, count }, { count: pendingCount }] = await Promise.all([
    listQuery.range(from, to),
    pendingCountQuery,
  ]);

  // Confirm payments the customer made but their browser never reported (only for rows this
  // reviewer can already see — the list above is already scoped to their own requests).
  const rows = requests || [];
  const unpaidIds = rows.filter((r: any) => r.status === "pending" && !r.customer_paid && r.pending_fapshi_trans_id).map((r: any) => r.id);
  if (unpaidIds.length > 0) {
    try {
      await reconcileSignupPayments(admin, { ids: unpaidIds, limit: 20 });
      const { data: fresh } = await admin.from("signup_requests").select("id, customer_paid, pending_fapshi_trans_id").in("id", unpaidIds);
      const byId = new Map((fresh || []).map((r: any) => [r.id, r]));
      for (const row of rows as any[]) {
        const f: any = byId.get(row.id);
        if (f) {
          row.customer_paid = f.customer_paid;
          row.pending_fapshi_trans_id = f.pending_fapshi_trans_id;
        }
      }
    } catch (err: any) {
      console.error("dashboard requests: payment confirmation failed:", err?.message);
    }
  }

  return (
    <RequestsTable
      requests={rows}
      basePath="/dashboard/requests"
      canDelete={reviewer.isAdmin}
      page={page}
      pageSize={PAGE_SIZE}
      totalCount={count ?? 0}
      pendingCount={pendingCount ?? 0}
    />
  );
}
