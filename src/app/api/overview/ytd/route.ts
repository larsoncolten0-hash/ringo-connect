import { overviewYtd } from "@/lib/overview/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only, read-only. Year to date (January through the chosen month): additive flows only. The business is the caller's own profile.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  return withOwner((owner) => overviewYtd(owner, { year: q.get("year"), month: q.get("month") }));
}
