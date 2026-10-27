import { churchRoute } from "@/lib/church/routeKit";
import { createGroupPhoto, listGroupPhotos } from "@/lib/church/pubgroups/handlers";

export const dynamic = "force-dynamic";

// GET the photos of a public group. POST { image_url, caption_en?, caption_fr?, sort_order? } adds one (at most 12; the children group takes no caption).
export const GET = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: false }, (actor, { params: query }) => listGroupPhotos(actor, params.id, query));
export const POST = (request: Request, { params }: { params: { id: string } }) => churchRoute(request, { write: true }, (actor, { body }) => createGroupPhoto(actor, params.id, body));
