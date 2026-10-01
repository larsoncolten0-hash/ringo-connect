import { voidDocument } from "@/lib/documents/handlers";
import { readJson, withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Void an invoice (a reason is required). Only possible while no payment is recorded against it; history and number are kept.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await readJson(request);
  return withOwner((owner) => voidDocument(owner, params.id, body));
}
