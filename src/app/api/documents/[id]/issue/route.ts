import { issueDocument } from "@/lib/documents/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Issue a draft. The request carries NO data: the invoice number, issue date, totals, snapshots and content hash are all
// determined by the database. Issuing twice is idempotent (returns the issued invoice).
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return withOwner((owner) => issueDocument(owner, params.id));
}
