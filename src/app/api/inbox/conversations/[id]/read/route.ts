import { withConversationActor } from "@/lib/inbox/actorRoute";
import { clearConversationUnread } from "@/lib/inbox/readState";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/inbox/conversations/<id>/read   (no body fields are read)
// Marks a conversation as read: the owner's own, or one a team member may mark (inbox.mark_read; re-checked by the database). Sets its unread_count to 0 and
// changes nothing else. The conversation is the one in the URL, the user comes from the session, and the database re-checks the relation to the owning
// organization. Never a GET: opening a page must not be the thing that writes.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withConversationActor(request, params.id, "inbox.mark_read", (actor) => clearConversationUnread(actor, params.id), {
    action: (r) => (r.body.ok && r.body.state === "cleared" ? "inbox_conversation_read" : null),
  });
}
