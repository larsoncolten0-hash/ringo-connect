import { churchRoute } from "@/lib/church/routeKit";
import { saveCounts } from "@/lib/church/attendance/handlers";

export const dynamic = "force-dynamic";

// POST { visitors, children, expected_updated_at? } sets the visitor and children counts of an event (numbers only, no names). Changing a count that already exists needs expected_updated_at.
export const POST = (request: Request, { params }: { params: { eventId: string } }) => churchRoute(request, { write: true }, (actor, { body }) => saveCounts(actor, params.eventId, body));
