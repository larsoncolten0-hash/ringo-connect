import { churchRoute } from "@/lib/church/routeKit";
import { createProgram, listPrograms } from "@/lib/church/bible/handlers";

export const dynamic = "force-dynamic";

// GET /api/church/bible?view=all|drafts|published&page=   POST /api/church/bible  (always creates a DRAFT programme)
// The church is the signed-in user's (server-resolved); anything else in the request is refused, not ignored. Needs church.bible.manage (drafts) or church.bible.publish.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => listPrograms(actor, params));
export const POST = (request: Request) => churchRoute(request, { write: true }, (actor, { body }) => createProgram(actor, body));
