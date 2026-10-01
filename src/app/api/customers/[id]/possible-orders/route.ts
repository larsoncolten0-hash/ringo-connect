import { possibleOrders } from "@/lib/customers/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only, READ-ONLY, loaded on demand. Shop orders whose buyer phone/e-mail share a normalised key with this customer. These are SUGGESTIONS: nothing is
// linked or stored, and they are never part of any total.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return withOwner((owner) => possibleOrders(owner, params.id));
}
