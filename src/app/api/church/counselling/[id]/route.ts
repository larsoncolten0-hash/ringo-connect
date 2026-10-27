import { churchRoute } from "@/lib/church/routeKit";
import { deleteCounselling, getCounselling, updateCounselling } from "@/lib/church/counselling/handlers";

export const dynamic = "force-dynamic";

// GET one request with its reason, contact details and history (church.counselling.view or manage). PATCH { status?, decision_note?, expected_updated_at } decides and/or notes (church.counselling.manage).
// DELETE ?expected_updated_at= removes it (church.counselling.manage). The version being changed is mandatory (400 if missing, 409 if it changed meanwhile).
export const GET = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: false }, (actor) => getCounselling(actor, params.id));
export const PATCH = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => updateCounselling(actor, params.id, body));
export const DELETE = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { params: query }) => deleteCounselling(actor, params.id, query));
