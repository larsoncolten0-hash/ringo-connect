import { withSavedReplyActor } from "@/lib/inbox/actorRoute";
import { saveSavedReply } from "@/lib/inbox/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/inbox/saved-replies   { title, body }   -> create one saved reply for the signed-in owner's organization, or for the organization a team member
// works in (inbox.saved_replies; the organization is server-resolved and re-checked by the database, never read from the request).
export async function POST(request: Request) {
  return withSavedReplyActor(request, (actor, body) => saveSavedReply(actor, null, { title: body.title, body: body.body }));
}
