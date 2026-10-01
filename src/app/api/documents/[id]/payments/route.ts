import { recordPayment } from "@/lib/documents/handlers";
import { readJson, withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Record a payment the BUSINESS received against an issued invoice. One call creates, atomically: the payment, its RCT- receipt and
// exactly one bookkeeping entry. `client_request_id` (a UUID) is required: a retry with the same id returns the original result.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await readJson(request);
  return withOwner((owner) => recordPayment(owner, params.id, body));
}
