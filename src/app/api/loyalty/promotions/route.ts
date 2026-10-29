import { requireLoyaltyAccess } from "@/lib/loyalty/access";
import { loyaltyRoute } from "@/lib/retention/route";
import { createPromotion, listPromotions } from "@/lib/retention/promotions";

export const dynamic = "force-dynamic";

// GET the offers of this business. POST { title, description?, kind: "percent" | "amount", value, code?, audience?, starts_at?, ends_at?, max_redemptions?, per_customer_limit? } adds a draft.
// Needs loyalty.manage.
// Reading is also open to staff who can scan (they need the live offers to apply one at the till).
export async function GET(request: Request) {
  const manage = await requireLoyaltyAccess(request, "loyalty.manage");
  return loyaltyRoute(request, manage.ok ? "loyalty.manage" : "loyalty.scan", { body: false }, (ctx) => listPromotions(ctx));
}
export const POST = (request: Request) => loyaltyRoute(request, "loyalty.manage", { body: true }, (ctx, body) => createPromotion(ctx, body));
