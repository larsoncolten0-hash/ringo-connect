import { voidPayment } from "@/lib/documents/handlers";
import { readJson, withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// The controlled way to void an invoice payment: voids the payment, its receipt AND its bookkeeping entry together, and moves the
// invoice back to its correct state. (The generic bookkeeping void route refuses these entries.) A reason is required; idempotent.
export async function POST(request: Request, { params }: { params: { paymentId: string } }) {
  const body = await readJson(request);
  return withOwner((owner) => voidPayment(owner, params.paymentId, body));
}
