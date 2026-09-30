import { createAdminClient } from "@/lib/supabase/server";
import RequestsTable from "@/components/admin/RequestsTable";
import { reconcileSignupPayments } from "@/lib/signupPayment";

export const dynamic = "force-dynamic";
// Confirming may ask Fapshi (with retries) for a handful of rows.
export const maxDuration = 30;

async function confirmUnpaidOnScreen(admin: ReturnType<typeof createAdminClient>, rows: any[]) {
  const ids = rows.filter((r) => r.status === "pending" && !r.customer_paid && r.pending_fapshi_trans_id).map((r) => r.id);
  if (ids.length === 0) return;
  try {
    await reconcileSignupPayments(admin, { ids, limit: 20 });
    const { data: fresh } = await admin.from("signup_requests").select("id, customer_paid, pending_fapshi_trans_id").in("id", ids);
    const byId = new Map((fresh || []).map((r: any) => [r.id, r]));
    for (const row of rows) {
      const f: any = byId.get(row.id);
      if (f) {
        row.customer_paid = f.customer_paid;
        row.pending_fapshi_trans_id = f.pending_fapshi_trans_id;
      }
    }
  } catch (err: any) {
    // Best effort: the list still renders exactly as before if Fapshi can't be reached.
    console.error("admin requests: payment confirmation failed:", err?.message);
  }
}

const PAGE_SIZE = 20;

export default async function AdminRequestsPage({ searchParams }: { searchParams: { page?: string } }) {
  const admin = createAdminClient();
  const page = Math.max(1, parseInt(searchParams?.page || "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const [{ data: requests, count }, { count: pendingCount }] = await Promise.all([
    admin
      .from("signup_requests")
      .select("*, plans(display_name, name)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to),
    admin.from("signup_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  // A customer who paid online but whose browser stopped watching is confirmed HERE, before the
  // admin sees the list — never shown as unpaid (which is what used to lead to "paid cash").
  const rows = requests || [];
  await confirmUnpaidOnScreen(admin, rows);

  return (
    <RequestsTable
      requests={rows}
      page={page}
      pageSize={PAGE_SIZE}
      totalCount={count ?? 0}
      pendingCount={pendingCount ?? 0}
    />
  );
}
