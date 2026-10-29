import { loyaltyRoute } from "@/lib/retention/route";
import { listReviewsForOwner } from "@/lib/retention/reviews";

export const dynamic = "force-dynamic";

// GET the reviews of this business (first name + initial, stars, words, status, reply). Not available for Churches & Ministries. Needs loyalty.manage.
export const GET = (request: Request) => loyaltyRoute(request, "loyalty.manage", { body: false }, (ctx) => listReviewsForOwner(ctx));
