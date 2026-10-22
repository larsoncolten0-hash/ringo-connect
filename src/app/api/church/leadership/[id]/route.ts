import { churchRoute } from "@/lib/church/routeKit";
import { updateLeadership } from "@/lib/church/handlers";

export const dynamic = "force-dynamic";

// PATCH { title?, started_on?, ended_on? }  edits an appointment or ENDS it (ended_on). There is deliberately no DELETE: an appointment is ended, and the history is kept.
export const PATCH = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => updateLeadership(actor, params.id, body));
