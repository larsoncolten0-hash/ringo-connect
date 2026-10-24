import { churchRoute } from "@/lib/church/routeKit";
import { unpublishTestimony } from "@/lib/church/testimonies/handlers";

export const dynamic = "force-dynamic";

// POST { confirm: true, expected_updated_at }: takes the testimony off the public page at once. Needs church.testimonies.manage (or publish).
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => unpublishTestimony(actor, params.id, body));
