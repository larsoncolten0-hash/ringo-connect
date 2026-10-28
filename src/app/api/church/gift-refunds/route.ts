import { churchRoute } from "@/lib/church/routeKit";
import { listRefundRequests } from "@/lib/church/giving/gifts/handlers";

export const dynamic = "force-dynamic";

// GET the refund requests on this church's gifts: a record of what a donor asked and what Ringo administration decided. Needs church.giving.manage. Nothing here moves money.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor) => listRefundRequests(actor));
