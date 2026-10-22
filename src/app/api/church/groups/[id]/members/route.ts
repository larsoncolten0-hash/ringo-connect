import { churchRoute } from "@/lib/church/routeKit";
import { addGroupMember } from "@/lib/church/handlers";

export const dynamic = "force-dynamic";

// POST /api/church/groups/[id]/members  { member_id, role? }  adds a person to the group.
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => addGroupMember(actor, params.id, body));
