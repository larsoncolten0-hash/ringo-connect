import { loyaltyRoute } from "@/lib/retention/route";
import { moderateReview } from "@/lib/retention/reviews";

export const dynamic = "force-dynamic";

// PATCH { status?: "published" | "hidden", reply?: string | null } hides, restores or answers a review. The rating and the words belong to the customer and cannot be changed. Needs loyalty.manage.
export const PATCH = (request: Request, { params }: { params: { id: string } }) => loyaltyRoute(request, "loyalty.manage", { body: true }, (ctx, body) => moderateReview(ctx, params.id, body));
