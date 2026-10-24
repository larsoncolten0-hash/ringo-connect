import { churchRoute } from "@/lib/church/routeKit";
import { cases } from "@/lib/church/care/handlers";

export const dynamic = "force-dynamic";

// POST { confirm: true, expected_updated_at }: takes the case back to a private draft. Needs the publish permission.
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => cases.unpublish(actor, params.id, body));
