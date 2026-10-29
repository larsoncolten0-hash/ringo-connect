import { churchRoute } from "@/lib/church/routeKit";
import { createService, listServices } from "@/lib/church/schedule/handlers";

export const dynamic = "force-dynamic";

// GET the church's weekly services (switched on or off; archived ones are not listed). POST { title_en?, title_fr?, weekday, start_time, end_time, timezone, description_*?, location?, is_enabled? } adds one.
// Reading needs church.events.view (or manage / publish); writing needs church.events.publish.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => listServices(actor, params));
export const POST = (request: Request) => churchRoute(request, { write: true }, (actor, { body }) => createService(actor, body));
