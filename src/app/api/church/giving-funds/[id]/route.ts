import { churchRoute } from "@/lib/church/routeKit";
import { deleteFund, updateFund } from "@/lib/church/giving/handlers";

export const dynamic = "force-dynamic";

// PATCH { ...fields, status?: "draft" | "closed", expected_updated_at } edits a fund (opening one is refused: 409 giving_unavailable); DELETE ?expected_updated_at= removes one.
export const PATCH = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => updateFund(actor, params.id, body));
export const DELETE = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { params: query }) => deleteFund(actor, params.id, query));
