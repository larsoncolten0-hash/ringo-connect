import { churchRoute } from "@/lib/church/routeKit";
import { publishProgram } from "@/lib/church/bible/handlers";

export const dynamic = "force-dynamic";

// POST { confirm: true, expected_updated_at }: publishes the programme (it needs a title and at least one session). Needs church.bible.publish.
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => publishProgram(actor, params.id, body));
