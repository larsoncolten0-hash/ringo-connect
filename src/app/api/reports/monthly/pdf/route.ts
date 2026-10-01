import { monthlyReportPdf } from "@/lib/reports/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only. The same report as a PDF, generated on the server on every request: never stored, never behind a public URL, and sent with
// private no-store headers.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  return withOwner((owner) => monthlyReportPdf(owner, { year: q.get("year"), month: q.get("month"), lang: q.get("lang") }));
}
