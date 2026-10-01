import { listContacts, saveContact } from "@/lib/receivables/handlers";
import { readJson, withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only contact book (merchant-owned; never merged automatically). GET lists (archived ones only with ?archived=1); POST creates, idempotent
// on `client_request_id`. An existing active contact with the same phone or email is reported (409), never merged.
export async function GET(request: Request) {
  const archived = new URL(request.url).searchParams.get("archived");
  return withOwner((owner) => listContacts(owner, { archived }));
}

export async function POST(request: Request) {
  const body = await readJson(request);
  return withOwner((owner) => saveContact(owner, null, body));
}
