import { receivablesSummary } from "@/lib/receivables/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only. Outstanding Balance and Overdue per currency (never mixed), aging, per-contact balances. Read-only: it never writes and never
// creates a bookkeeping entry; a debt IS the Amount Due on an issued invoice (there is no separate debt ledger).
export async function GET() {
  return withOwner((owner) => receivablesSummary(owner));
}
