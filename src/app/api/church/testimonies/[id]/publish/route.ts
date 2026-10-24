import { churchRoute } from "@/lib/church/routeKit";
import { publishTestimony } from "@/lib/church/testimonies/handlers";

export const dynamic = "force-dynamic";

// POST { confirm: true, expected_updated_at }: publishes an APPROVED testimony whose submitter gave publication consent. Needs church.testimonies.publish.
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => publishTestimony(actor, params.id, body));
