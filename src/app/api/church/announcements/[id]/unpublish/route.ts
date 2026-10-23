import { churchRoute } from "@/lib/church/routeKit";
import { announcements } from "@/lib/church/lifecycle/events";

export const dynamic = "force-dynamic";

// POST { confirm: true, expected_updated_at }: takes the announcement down (back to a draft). Needs the publish permission.
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => announcements.unpublish(actor, params.id, body));
