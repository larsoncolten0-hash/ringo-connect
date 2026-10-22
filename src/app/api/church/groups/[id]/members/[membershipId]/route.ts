import { churchRoute } from "@/lib/church/routeKit";
import { removeGroupMember, updateGroupMember } from "@/lib/church/handlers";

export const dynamic = "force-dynamic";

// PATCH { role }  changes a person's role in the group;  DELETE  removes them from it. A group leader may do both for plain members only; the database enforces it.
export const PATCH = (request: Request, { params }: { params: { id: string; membershipId: string } }) =>
  churchRoute(request, { write: true }, (actor, { body }) => updateGroupMember(actor, params.id, params.membershipId, body));
export const DELETE = (request: Request, { params }: { params: { id: string; membershipId: string } }) =>
  churchRoute(request, { write: true }, (actor) => removeGroupMember(actor, params.id, params.membershipId));
