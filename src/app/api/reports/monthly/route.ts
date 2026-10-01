import { monthlyReport } from "@/lib/reports/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only. The monthly report as JSON (integer minor units, one currency). Read-only: nothing is written and no figure comes from the request.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  return withOwner((owner) => monthlyReport(owner, { year: q.get("year"), month: q.get("month") }));
}
