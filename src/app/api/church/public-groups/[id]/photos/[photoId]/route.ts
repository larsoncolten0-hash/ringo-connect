import { churchRoute } from "@/lib/church/routeKit";
import { deleteGroupPhoto, updateGroupPhoto } from "@/lib/church/pubgroups/handlers";

export const dynamic = "force-dynamic";

// PATCH { ...fields, expected_updated_at } edits a photo; DELETE ?expected_updated_at= removes it.
export const PATCH = (request: Request, { params }: { params: { id: string; photoId: string } }) => churchRoute(request, { write: true }, (actor, { body }) => updateGroupPhoto(actor, params.id, params.photoId, body));
export const DELETE = (request: Request, { params }: { params: { id: string; photoId: string } }) => churchRoute(request, { write: true }, (actor, { params: query }) => deleteGroupPhoto(actor, params.id, params.photoId, query));
