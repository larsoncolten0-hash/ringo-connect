import { churchRoute } from "@/lib/church/routeKit";
import { createMember, listMembers } from "@/lib/church/handlers";

export const dynamic = "force-dynamic";

// GET /api/church/members?page=&q=&status=&age_group=&group_id=   POST /api/church/members
// The church is the signed-in user's (server-resolved); a profile id in the request is refused, not ignored.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => listMembers(actor, params));
export const POST = (request: Request) => churchRoute(request, { write: true }, (actor, { body }) => createMember(actor, body));
