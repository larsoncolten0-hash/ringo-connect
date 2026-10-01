import { overviewSummary } from "@/lib/overview/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only. The Business Toolkit Overview as JSON (integer minor units, one currency, no profit). Read-only: nothing is written and nothing comes from the request.
export async function GET() {
  return withOwner((owner) => overviewSummary(owner));
}
