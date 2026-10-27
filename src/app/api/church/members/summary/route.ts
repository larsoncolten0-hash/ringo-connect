import { churchRoute } from "@/lib/church/routeKit";
import { membersSummary } from "@/lib/church/membership/handlers";

export const dynamic = "force-dynamic";

// GET the counts at the top of the Members screen: members, adults, youth, requests waiting (and children for a person who may see them). Counts only, never a name. Needs church.members.view.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => membersSummary(actor, params));
