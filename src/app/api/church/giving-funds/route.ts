import { churchRoute } from "@/lib/church/routeKit";
import { createFund, listFunds } from "@/lib/church/giving/handlers";

export const dynamic = "force-dynamic";

// GET the church's giving and care funds (drafts included). POST { kind, title_en, title_fr, description_en?, description_fr?, goal_xaf?, is_published? } adds one as a draft. Needs church.giving.manage.
// These are the DEFINITIONS of what a church wants to raise money for. Nothing here collects or holds money.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => listFunds(actor, params));
export const POST = (request: Request) => churchRoute(request, { write: true }, (actor, { body }) => createFund(actor, body));
