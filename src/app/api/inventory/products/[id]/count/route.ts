import { correctCount } from "@/lib/inventory/handlers";
import { withOwner, readJson } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only. Count correction to a counted quantity. One atomic database operation (stock + ledger row in one transaction); idempotent by client_request_id.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await readJson(request);
  return withOwner((owner) => correctCount(owner, params.id, body));
}
