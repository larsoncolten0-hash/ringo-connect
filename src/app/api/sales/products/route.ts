import { withOwner } from "@/lib/documents/routeKit";
import { listSaleProducts } from "@/lib/sales/handlers";

export const dynamic = "force-dynamic";

// Owner-only, read-only: the catalogue products offered by Record Sale, with stock and whether it is tracked.
export async function GET() {
  return withOwner((owner) => listSaleProducts(owner));
}
