import { listCustomers } from "@/lib/customers/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only, READ-ONLY. The business's own customer directory (bk_customers), searchable and paged. Creating, editing, archiving and pausing a
// contact stay on the existing /api/receivables/customers/** endpoints.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  return withOwner((owner) => listCustomers(owner, { q: q.get("q"), status: q.get("status"), limit: q.get("limit"), offset: q.get("offset") }));
}
