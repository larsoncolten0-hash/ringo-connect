import { withInboxOwner } from "@/lib/inbox/route";
import { clearConversationUnread } from "@/lib/inbox/readState";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/inbox/conversations/<id>/read   (no body fields are read)
// Marks one of the signed-in owner's conversations as read: sets its unread_count to 0 and changes nothing else. The conversation is the one in
// the URL, the owner comes from the session, and the database re-checks ownership. Never a GET: opening a page must not be the thing that writes.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withInboxOwner(request, (actor) => clearConversationUnread(actor, params.id));
}
