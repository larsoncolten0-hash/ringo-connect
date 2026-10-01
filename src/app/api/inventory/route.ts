import { inventoryOverview } from "@/lib/inventory/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only. Tracked/untracked products with out / low / ok status, Reserved vs Sold, optional informational value. Read-only.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  return withOwner((owner) => inventoryOverview(owner, { filter: q.get("filter"), limit: q.get("limit"), offset: q.get("offset") }));
}
