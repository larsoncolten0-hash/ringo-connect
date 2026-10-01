import { getDocumentCustomer, setDocumentCustomer } from "@/lib/receivables/handlers";
import { readJson, withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// The contact an invoice is linked to. PUT { "customer_id": uuid | null } links or unlinks. The invoice and its frozen customer snapshot
// are never changed by linking.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return withOwner((owner) => getDocumentCustomer(owner, params.id));
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const body = await readJson(request);
  return withOwner((owner) => setDocumentCustomer(owner, params.id, body));
}
