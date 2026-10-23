import { churchRoute } from "@/lib/church/routeKit";
import { events } from "@/lib/church/lifecycle/events";

export const dynamic = "force-dynamic";

// GET /api/church/events?view=&page=   POST /api/church/events  (always creates a DRAFT)
// The church is the signed-in user's (server-resolved); anything else in the request is refused, not ignored. Needs church.events.manage (drafts) or church.events.publish.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => events.list(actor, params));
export const POST = (request: Request) => churchRoute(request, { write: true }, (actor, { body }) => events.create(actor, body));
