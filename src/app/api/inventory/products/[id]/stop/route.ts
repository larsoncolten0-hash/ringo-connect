import { stopTracking } from "@/lib/inventory/handlers";
import { withOwner, readJson } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only. Stop tracking (product becomes unlimited again, ledger kept). One atomic database operation (stock + ledger row in one transaction); idempotent by client_request_id.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await readJson(request);
  return withOwner((owner) => stopTracking(owner, params.id, body));
}
