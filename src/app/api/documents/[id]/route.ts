import { discardDraft, getDocument, updateDraft } from "@/lib/documents/handlers";
import { readJson, withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// One document (invoice or receipt) with its lines, payments, receipts and history.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return withOwner((owner) => getDocument(owner, params.id));
}

// Replace a DRAFT's content. Issued documents are immutable: the database refuses, and this route says so first.
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const body = await readJson(request);
  return withOwner((owner) => updateDraft(owner, params.id, body));
}

// "Delete" a draft = discard it (void). Nothing is ever deleted; an issued document is voided through /void instead.
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  return withOwner((owner) => discardDraft(owner, params.id));
}
