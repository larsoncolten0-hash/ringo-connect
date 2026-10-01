import { createDraft, listDocuments } from "@/lib/documents/handlers";
import { readJson, withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// List the owner's invoices (optionally filtered by status) / create a draft. A draft has no number and consumes none.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  return withOwner((owner) => listDocuments(owner, { status: q.get("status"), limit: q.get("limit"), offset: q.get("offset") }));
}

export async function POST(request: Request) {
  const body = await readJson(request);
  return withOwner((owner) => createDraft(owner, body));
}
