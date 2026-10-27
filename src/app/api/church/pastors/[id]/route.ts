import { churchRoute } from "@/lib/church/routeKit";
import { deletePastor, updatePastor } from "@/lib/church/pubgroups/handlers";

export const dynamic = "force-dynamic";

// PATCH { ...fields, expected_updated_at } edits a pastor; DELETE ?expected_updated_at= removes one.
export const PATCH = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => updatePastor(actor, params.id, body));
export const DELETE = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { params: query }) => deletePastor(actor, params.id, query));
