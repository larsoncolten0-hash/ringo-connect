import { loyaltyRoute } from "@/lib/retention/route";
import { getSegmentsSummary } from "@/lib/retention/promotions";

export const dynamic = "force-dynamic";

// GET the number of connected customers in each segment (new, returning, VIP, inactive). Counts only: never a name, never a list. Needs loyalty.manage.
export const GET = (request: Request) => loyaltyRoute(request, "loyalty.manage", { body: false }, (ctx) => getSegmentsSummary(ctx));
