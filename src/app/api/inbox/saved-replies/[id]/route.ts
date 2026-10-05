import { withInboxOwner } from "@/lib/inbox/route";
import { withSavedReplyActor } from "@/lib/inbox/actorRoute";
import { deleteSavedReply, saveSavedReply } from "@/lib/inbox/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH  /api/inbox/saved-replies/<id>   { title, body }  -> edit the owner's saved reply
// DELETE /api/inbox/saved-replies/<id>                    -> delete the owner's saved reply (the only deletion in the Inbox). OWNER ONLY: team members are never
//                                                            admitted here (withInboxOwner) and there is no member database function for it.
// The id selects among the OWNER's replies only: the database matches (id, profile derived from the session), so another profile's id is "not found".
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return withSavedReplyActor(request, (actor, body) => saveSavedReply(actor, params.id, { title: body.title, body: body.body }));
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  return withInboxOwner(request, (actor) => deleteSavedReply(actor, params.id));
}
