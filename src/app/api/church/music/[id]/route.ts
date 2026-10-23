import { churchRoute } from "@/lib/church/routeKit";
import { deleteMusic, updateMusic } from "@/lib/church/music/handlers";

export const dynamic = "force-dynamic";

// PATCH { ...fields, expected_updated_at } edits or hides a link; DELETE ?expected_updated_at= removes it. The version being changed is mandatory (400 if missing, 409 if it changed meanwhile).
export const PATCH = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => updateMusic(actor, params.id, body));
export const DELETE = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { params: query }) => deleteMusic(actor, params.id, query));
