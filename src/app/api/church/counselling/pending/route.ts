import { churchRoute } from "@/lib/church/routeKit";
import { countPending } from "@/lib/church/counselling/handlers";

export const dynamic = "force-dynamic";

// GET how many requests are waiting: a number, never a name. Needs church.counselling.view or manage.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor) => countPending(actor));
