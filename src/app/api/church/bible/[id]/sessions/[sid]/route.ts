import { churchRoute } from "@/lib/church/routeKit";
import { deleteSession, updateSession } from "@/lib/church/bible/handlers";

export const dynamic = "force-dynamic";

// PATCH one session (content only; needs expected_updated_at) / DELETE it (?expected_updated_at= is mandatory). manage permission while the programme is a draft; publish permission once it is live.
export const PATCH = (request: Request, { params }: { params: { id: string; sid: string } }) => churchRoute(request, { write: true }, (actor, { body }) => updateSession(actor, params.id, params.sid, body));
export const DELETE = (request: Request, { params }: { params: { id: string; sid: string } }) => churchRoute(request, { write: true }, (actor, { params: query }) => deleteSession(actor, params.id, params.sid, query));
