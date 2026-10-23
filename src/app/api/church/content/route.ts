import { churchRoute } from "@/lib/church/routeKit";
import { createWord, listWords } from "@/lib/church/content/handlers";

export const dynamic = "force-dynamic";

// GET /api/church/content?view=all|drafts|scheduled|published&page=   POST /api/church/content  (always creates a DRAFT)
// The church is the signed-in user's (server-resolved); anything else in the request is refused, not ignored.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => listWords(actor, params));
export const POST = (request: Request) => churchRoute(request, { write: true }, (actor, { body }) => createWord(actor, body));
