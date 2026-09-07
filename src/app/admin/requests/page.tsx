import { createAdminClient } from "@/lib/supabase/server";
import RequestsTable from "@/components/admin/RequestsTable";

export const dynamic = "force-dynamic";

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

  return (
    <RequestsTable
      requests={requests || []}
      page={page}
      pageSize={PAGE_SIZE}
      totalCount={count ?? 0}
      pendingCount={pendingCount ?? 0}
    />
  );
}
