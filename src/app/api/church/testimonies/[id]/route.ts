import { churchRoute } from "@/lib/church/routeKit";
import { editTestimony, getTestimony } from "@/lib/church/testimonies/handlers";

export const dynamic = "force-dynamic";

// GET one testimony with its moderation history. PATCH { public_body?, moderation_note?, expected_updated_at } is the explicit, logged staff correction: the submitter's own words are never changed.
export const GET = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: false }, (actor) => getTestimony(actor, params.id));
export const PATCH = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => editTestimony(actor, params.id, body));
