import { churchRoute } from "@/lib/church/routeKit";
import { getStoreSummary } from "@/lib/church/store/summary";

export const dynamic = "force-dynamic";

// GET /api/church/store-summary?from=&to=: totals of the church's own Shop orders for a range of Africa/Douala days (counts and whole-XAF totals, never a buyer). Owner only, read-only; it never reads giving.
export async function GET(request: Request) {
  return churchRoute(request, { write: false }, (actor, { params }) => getStoreSummary(actor, params));
}
