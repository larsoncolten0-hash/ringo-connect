import { churchRoute } from "@/lib/church/routeKit";
import { announcements } from "@/lib/church/lifecycle/events";

export const dynamic = "force-dynamic";

// POST { confirm: true, expected_updated_at }: publishes the announcement. Needs the publish permission.
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => announcements.publish(actor, params.id, body));
