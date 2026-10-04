import { withInboxOwner } from "@/lib/inbox/route";
import { saveSavedReply } from "@/lib/inbox/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/inbox/saved-replies   { title, body }   -> create one saved reply for the signed-in owner's profile (derived from the session).
export async function POST(request: Request) {
  return withInboxOwner(request, (actor, body) => saveSavedReply(actor, null, { title: body.title, body: body.body }));
}
