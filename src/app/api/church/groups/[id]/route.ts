import { churchRoute } from "@/lib/church/routeKit";
import { deleteGroup, getGroup, updateGroup } from "@/lib/church/handlers";

export const dynamic = "force-dynamic";

// GET (with its members) / PATCH (rename, describe, archive) / DELETE one group of the signed-in user's church.
export const GET = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: false }, (actor) => getGroup(actor, params.id));
export const PATCH = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => updateGroup(actor, params.id, body));
export const DELETE = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor) => deleteGroup(actor, params.id));
