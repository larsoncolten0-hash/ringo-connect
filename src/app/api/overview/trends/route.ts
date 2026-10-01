import { overviewTrends } from "@/lib/overview/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only, read-only. Monthly trend (3, 6 or 12 months) with the comparison against the previous equivalent period. The business is the caller's own profile.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  return withOwner((owner) => overviewTrends(owner, { year: q.get("year"), month: q.get("month"), span: q.get("span") }));
}
