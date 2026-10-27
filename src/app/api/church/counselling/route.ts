import { churchRoute } from "@/lib/church/routeKit";
import { listCounselling } from "@/lib/church/counselling/handlers";

export const dynamic = "force-dynamic";

// GET ?status=&page=&q= the counselling requests of the church (name, language, status and dates: never the reason). Needs church.counselling.view or manage. Requests are created by the public page only.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => listCounselling(actor, params));
