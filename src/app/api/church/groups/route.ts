import { churchRoute } from "@/lib/church/routeKit";
import { createGroup, listGroups } from "@/lib/church/handlers";

export const dynamic = "force-dynamic";

// GET /api/church/groups?status=&kind=   POST /api/church/groups
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => listGroups(actor, params));
export const POST = (request: Request) => churchRoute(request, { write: true }, (actor, { body }) => createGroup(actor, body));
