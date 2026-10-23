import { churchRoute } from "@/lib/church/routeKit";
import { unpublishProgram } from "@/lib/church/bible/handlers";

export const dynamic = "force-dynamic";

// POST { confirm: true, expected_updated_at }: takes the programme down (back to a draft). Participants keep their progress; nobody can join or tick while it is a draft. Needs church.bible.publish.
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => unpublishProgram(actor, params.id, body));
