import { customerRoute } from "@/lib/retention/route";
import { deleteMyReview, myReviewables, saveMyReview } from "@/lib/retention/reviews";

export const dynamic = "force-dynamic";

// The signed-in customer's own reviews (the customer comes from the cookie only).
//   GET                                 every active connection: whether a review is offered, whether this customer may write one, and their own review
//   PUT { profile_id, rating, body? }   write or edit (needs an active connection and a real interaction; refused for Churches & Ministries)
//   DELETE ?profile_id=                 remove their own review
const profileIdOf = (request: Request): string => {
  try {
    return new URL(request.url).searchParams.get("profile_id") || "";
  } catch {
    return "";
  }
};
export const GET = (request: Request) => customerRoute(request, { write: false }, (ctx) => myReviewables(ctx.db, ctx.customer.id));
export const PUT = (request: Request) => customerRoute(request, { write: true, body: true }, (ctx, body) => saveMyReview(ctx.db, ctx.customer.id, body));
export const DELETE = (request: Request) => customerRoute(request, { write: true }, (ctx) => deleteMyReview(ctx.db, ctx.customer.id, profileIdOf(request)));
