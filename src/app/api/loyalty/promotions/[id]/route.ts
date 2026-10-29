import { loyaltyRoute } from "@/lib/retention/route";
import { deletePromotion, updatePromotion } from "@/lib/retention/promotions";

export const dynamic = "force-dynamic";

// PATCH edits a draft (a live offer keeps its terms: only its end, cap, description and status change; status "active" starts it, "ended" stops it). DELETE removes an unused draft, or ends anything
// else (what was sent and redeemed is kept). Needs loyalty.manage.
export const PATCH = (request: Request, { params }: { params: { id: string } }) => loyaltyRoute(request, "loyalty.manage", { body: true }, (ctx, body) => updatePromotion(ctx, params.id, body));
export const DELETE = (request: Request, { params }: { params: { id: string } }) => loyaltyRoute(request, "loyalty.manage", { body: false }, (ctx) => deletePromotion(ctx, params.id));
