import { withInboxOwner } from "@/lib/inbox/route";
import { setConversationStatus } from "@/lib/inbox/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/inbox/conversations/<id>/status   { status: "open" | "closed" }
// Closes or reopens one of the signed-in owner's conversations. Changes only its status (never unread_count, messages or provider statuses).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withInboxOwner(request, (actor, body) => setConversationStatus(actor, params.id, body.status));
}
