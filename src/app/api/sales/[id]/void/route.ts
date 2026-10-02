import { readJson, withOwner } from "@/lib/documents/routeKit";
import { voidSale } from "@/lib/sales/handlers";

export const dynamic = "force-dynamic";

// Owner-only (the Business Toolkit gate; staff are not admitted). Voids a recorded sale ATOMICALLY: the receipt is marked void, the bookkeeping sale is voided
// and the stock the sale took is put back, all or nothing. A second call answers 200 with already_voided and changes nothing.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await readJson(request);
  return withOwner((owner) => voidSale(owner, params.id, body));
}
