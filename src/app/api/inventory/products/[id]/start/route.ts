import { startTracking } from "@/lib/inventory/handlers";
import { withOwner, readJson } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only. Start or adopt tracking. One atomic database operation (stock + ledger row in one transaction); idempotent by client_request_id.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await readJson(request);
  return withOwner((owner) => startTracking(owner, params.id, body));
}
