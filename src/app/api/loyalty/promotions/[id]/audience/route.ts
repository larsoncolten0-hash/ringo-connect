import { loyaltyRoute } from "@/lib/retention/route";
import { previewPromotion } from "@/lib/retention/promotions";

export const dynamic = "force-dynamic";

// GET how many customers would receive this offer by e-mail and by push - only those whose EFFECTIVE marketing consent allows the channel. Counts only. Needs loyalty.manage.
export const GET = (request: Request, { params }: { params: { id: string } }) => loyaltyRoute(request, "loyalty.manage", { body: false }, (ctx) => previewPromotion(ctx, params.id));
