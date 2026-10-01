import { refundedOrders } from "@/lib/inventory/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only: refunded Shop orders of this product with how many units may still be restocked. Read-only.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return withOwner((owner) => refundedOrders(owner, params.id));
}
