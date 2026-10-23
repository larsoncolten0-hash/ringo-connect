import { churchRoute } from "@/lib/church/routeKit";
import { deleteWord, getWord, updateWord } from "@/lib/church/content/handlers";

export const dynamic = "force-dynamic";

// GET / PATCH (content and date only: never the status) / DELETE (?expected_updated_at= is mandatory) one Daily Word of the signed-in user's church.
export const GET = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: false }, (actor) => getWord(actor, params.id));
export const PATCH = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => updateWord(actor, params.id, body));
export const DELETE = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { params: query }) => deleteWord(actor, params.id, query));
