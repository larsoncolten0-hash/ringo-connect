import { withConversationActor } from "@/lib/inbox/actorRoute";
import { setConversationStatus } from "@/lib/inbox/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/inbox/conversations/<id>/status   { status: "open" | "closed" }
// Closes or reopens a conversation: the owner's own, or one a team member may close (inbox.close; re-checked by the database). Changes only its status
// (never unread_count, messages or provider statuses). A team member's action is recorded in the organization activity log.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withConversationActor(request, params.id, "inbox.close", (actor, body) => setConversationStatus(actor, params.id, body.status), {
    action: (r) => (r.body.ok && r.body.state === "closed" ? "inbox_conversation_closed" : r.body.ok && r.body.state === "open" ? "inbox_conversation_reopened" : null),
  });
}
