import { contactStatement, saveContact } from "@/lib/receivables/handlers";
import { readJson, withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// GET: the statement of one contact (their invoices, payments recorded, Outstanding Balance per currency). PUT: edit the contact.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return withOwner((owner) => contactStatement(owner, params.id));
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const body = await readJson(request);
  return withOwner((owner) => saveContact(owner, params.id, body));
}
