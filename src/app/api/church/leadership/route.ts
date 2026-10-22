import { churchRoute } from "@/lib/church/routeKit";
import { createLeadership, listLeadership } from "@/lib/church/handlers";

export const dynamic = "force-dynamic";

// GET /api/church/leadership?current=true|false&member_id=   POST /api/church/leadership
// Private to the church's dashboard: nothing here is, or becomes, public.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => listLeadership(actor, params));
export const POST = (request: Request) => churchRoute(request, { write: true }, (actor, { body }) => createLeadership(actor, body));
