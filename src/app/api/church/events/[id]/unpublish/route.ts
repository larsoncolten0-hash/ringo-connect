import { churchRoute } from "@/lib/church/routeKit";
import { events } from "@/lib/church/lifecycle/events";

export const dynamic = "force-dynamic";

// POST { confirm: true, expected_updated_at }: takes the event down (back to a draft). Needs the publish permission.
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => events.unpublish(actor, params.id, body));
