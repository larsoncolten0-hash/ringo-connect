import { churchRoute } from "@/lib/church/routeKit";
import { deleteProgram, getProgram, updateProgram } from "@/lib/church/bible/handlers";

export const dynamic = "force-dynamic";

// GET one programme with its sessions and the participant COUNTS (never a name) / PATCH (content only: never the status; needs expected_updated_at) / DELETE (?expected_updated_at= is mandatory).
// A programme that has participants cannot be deleted: unpublish it.
export const GET = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: false }, (actor) => getProgram(actor, params.id));
export const PATCH = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => updateProgram(actor, params.id, body));
export const DELETE = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { params: query }) => deleteProgram(actor, params.id, query));
