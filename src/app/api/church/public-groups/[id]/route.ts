import { churchRoute } from "@/lib/church/routeKit";
import { deletePublicGroup, updatePublicGroup } from "@/lib/church/pubgroups/handlers";

export const dynamic = "force-dynamic";

// PATCH { ...fields, expected_updated_at } edits a public group (its kind never changes); DELETE ?expected_updated_at= removes it with its photos and the notices addressed to it.
export const PATCH = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => updatePublicGroup(actor, params.id, body));
export const DELETE = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { params: query }) => deletePublicGroup(actor, params.id, query));
