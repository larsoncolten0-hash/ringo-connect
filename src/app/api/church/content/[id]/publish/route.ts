import { churchRoute } from "@/lib/church/routeKit";
import { publishWord } from "@/lib/church/content/handlers";

export const dynamic = "force-dynamic";

// POST { confirm: true, expected_updated_at }: publishes the entry (a future date means it is scheduled and goes live on that date). Needs church.content.publish.
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => publishWord(actor, params.id, body));
