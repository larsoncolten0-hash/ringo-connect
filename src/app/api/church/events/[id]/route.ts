import { churchRoute } from "@/lib/church/routeKit";
import { events } from "@/lib/church/lifecycle/events";

export const dynamic = "force-dynamic";

// GET / PATCH (content only: never the status; needs expected_updated_at) / DELETE (?expected_updated_at= is mandatory) one event of the signed-in user's church.
export const GET = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: false }, (actor) => events.get(actor, params.id));
export const PATCH = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => events.update(actor, params.id, body));
export const DELETE = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { params: query }) => events.remove(actor, params.id, query));
