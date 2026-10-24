import { churchRoute } from "@/lib/church/routeKit";
import { cases } from "@/lib/church/care/handlers";

export const dynamic = "force-dynamic";

// GET /api/church/care?view=&page=   POST /api/church/care  (always creates a PRIVATE DRAFT case)
// Care cases are private until they are published, and publishing needs the beneficiary's recorded consent. There is no money here. Needs church.care.manage (drafts) or church.care.publish.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => cases.list(actor, params));
export const POST = (request: Request) => churchRoute(request, { write: true }, (actor, { body }) => cases.create(actor, body));
