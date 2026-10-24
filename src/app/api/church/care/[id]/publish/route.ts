import { churchRoute } from "@/lib/church/routeKit";
import { cases } from "@/lib/church/care/handlers";

export const dynamic = "force-dynamic";

// POST { confirm: true, expected_updated_at }: publishes the case. Needs the publish permission AND a recorded, granted consent (otherwise 422 needs_consent).
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => cases.publish(actor, params.id, body));
