import { churchRoute } from "@/lib/church/routeKit";
import { unpublishWord } from "@/lib/church/content/handlers";

export const dynamic = "force-dynamic";

// POST { confirm: true, expected_updated_at }: takes the entry down (back to a draft). Needs church.content.publish.
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => unpublishWord(actor, params.id, body));
