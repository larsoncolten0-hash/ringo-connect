import { churchRoute } from "@/lib/church/routeKit";
import { getAbout, saveAbout } from "@/lib/church/pubgroups/handlers";

export const dynamic = "force-dynamic";

// GET the church's vision and mission. PUT { vision_en?, vision_fr?, mission_en?, mission_fr?, is_published?, expected_updated_at } saves them (the version is only required once a row exists). Needs church.pastors.manage.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => getAbout(actor, params));
export const PUT = (request: Request) => churchRoute(request, { write: true }, (actor, { body }) => saveAbout(actor, body));
