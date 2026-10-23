import { churchRoute } from "@/lib/church/routeKit";
import { announcements } from "@/lib/church/lifecycle/events";

export const dynamic = "force-dynamic";

// GET /api/church/announcements?view=&page=   POST /api/church/announcements  (always creates a DRAFT)
// The church is the signed-in user's (server-resolved); anything else in the request is refused, not ignored. Needs church.events.manage (drafts) or church.events.publish.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => announcements.list(actor, params));
export const POST = (request: Request) => churchRoute(request, { write: true }, (actor, { body }) => announcements.create(actor, body));
