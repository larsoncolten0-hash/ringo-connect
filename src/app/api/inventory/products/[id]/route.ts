import { productDetail } from "@/lib/inventory/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only product detail: settings, movement history, order holds. Read-only.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const q = new URL(request.url).searchParams;
  return withOwner((owner) => productDetail(owner, params.id, { limit: q.get("limit"), offset: q.get("offset") }));
}
