import { churchRoute } from "@/lib/church/routeKit";
import { getFeatures, saveFeatures } from "@/lib/church/features/handlers";

export const dynamic = "force-dynamic";

// GET the church's feature switches (Bible in one year, counselling, giving). PUT { bible_year?, counselling?, giving?, expected_updated_at? } saves them. Church OWNER only; every feature is off until switched on.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => getFeatures(actor, params));
export const PUT = (request: Request) => churchRoute(request, { write: true }, (actor, { body }) => saveFeatures(actor, body));
