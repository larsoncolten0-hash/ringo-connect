import { setContactArchived } from "@/lib/receivables/handlers";
import { readJson, withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Archive or restore a contact ({ "archived": true|false }). Nothing is ever deleted; links and history stay.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await readJson(request);
  return withOwner((owner) => setContactArchived(owner, params.id, body));
}
