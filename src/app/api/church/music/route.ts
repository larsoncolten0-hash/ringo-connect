import { churchRoute } from "@/lib/church/routeKit";
import { createMusic, listMusic } from "@/lib/church/music/handlers";

export const dynamic = "force-dynamic";

// GET the church's music links (visible and hidden). POST { platform, title, url, is_visible?, sort_order? } adds one. Needs church.music.manage.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => listMusic(actor, params));
export const POST = (request: Request) => churchRoute(request, { write: true }, (actor, { body }) => createMusic(actor, body));
