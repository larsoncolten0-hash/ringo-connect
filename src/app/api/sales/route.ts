import { readJson, withOwner } from "@/lib/documents/routeKit";
import { listRecentSales, recordSale } from "@/lib/sales/handlers";

export const dynamic = "force-dynamic";

// Owner-only (the Business Toolkit gate). GET: the last sale receipts. POST: Record Sale, ONE atomic operation (bookkeeping sale + stock + standalone receipt),
// idempotent on `client_request_id`.
export async function GET() {
  return withOwner((owner) => listRecentSales(owner));
}

export async function POST(request: Request) {
  const body = await readJson(request);
  return withOwner((owner) => recordSale(owner, body));
}
