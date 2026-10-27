import { churchRoute } from "@/lib/church/routeKit";
import { createPastor, listPastors } from "@/lib/church/pubgroups/handlers";

export const dynamic = "force-dynamic";

// GET the church's pastors (drafts included). POST { name, photo_url?, word_en?, word_fr?, bio_en?, bio_fr?, sort_order?, is_published? } adds one. Needs church.pastors.manage.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => listPastors(actor, params));
export const POST = (request: Request) => churchRoute(request, { write: true }, (actor, { body }) => createPastor(actor, body));
