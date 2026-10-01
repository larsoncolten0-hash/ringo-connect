import { receivableInvoices } from "@/lib/receivables/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only, read-only, paged list of issued invoices that still have an Amount Due (filters: customer, unassigned, overdue, currency).
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  return withOwner((owner) => receivableInvoices(owner, {
    customer: q.get("customer"), unassigned: q.get("unassigned"), overdue: q.get("overdue"), currency: q.get("currency"), limit: q.get("limit"), offset: q.get("offset"),
  }));
}
