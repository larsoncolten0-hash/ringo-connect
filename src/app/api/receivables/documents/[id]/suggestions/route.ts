import { suggestContacts } from "@/lib/receivables/handlers";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Contacts of the SAME business whose phone/email matches this invoice. A suggestion never links anything.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return withOwner((owner) => suggestContacts(owner, params.id));
}
