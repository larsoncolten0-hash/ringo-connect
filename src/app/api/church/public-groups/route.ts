import { churchRoute } from "@/lib/church/routeKit";
import { createPublicGroup, listPublicGroups } from "@/lib/church/pubgroups/handlers";

export const dynamic = "force-dynamic";

// GET the church's public groups (Men, Women, Youths, Children). POST { kind, leader_name?, leader_photo_url?, description_en?, description_fr?, is_published? } creates one. Writing needs church.groups.manage.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => listPublicGroups(actor, params));
export const POST = (request: Request) => churchRoute(request, { write: true }, (actor, { body }) => createPublicGroup(actor, body));
