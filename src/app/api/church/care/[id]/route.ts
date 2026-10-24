import { churchRoute } from "@/lib/church/routeKit";
import { cases } from "@/lib/church/care/handlers";

export const dynamic = "force-dynamic";

// GET / PATCH (content only: never the status or the consent; needs expected_updated_at) / DELETE (?expected_updated_at= is mandatory) one care case of the signed-in user's church.
export const GET = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: false }, (actor) => cases.get(actor, params.id));
export const PATCH = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => cases.update(actor, params.id, body));
export const DELETE = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { params: query }) => cases.remove(actor, params.id, query));
