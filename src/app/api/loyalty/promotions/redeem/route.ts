import { loyaltyRoute } from "@/lib/retention/route";
import { redeemPromotion } from "@/lib/retention/promotions";

export const dynamic = "force-dynamic";

// POST { connection_id, promotion_id, amount, key } applies an offer at the till for a customer connected to this business (found by scanning or searching, as in Loyalty). The discount is computed
// from the bill amount the staff typed. Needs loyalty.scan (the same permission that records a visit).
export const POST = (request: Request) => loyaltyRoute(request, "loyalty.scan", { body: true }, (ctx, body) => redeemPromotion(ctx, body));
